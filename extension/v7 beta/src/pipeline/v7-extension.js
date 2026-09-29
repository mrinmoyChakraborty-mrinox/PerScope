/**
 * PerScope v7 Pipeline - Full Browser / Chrome Extension Port
 * Algorithmic and evidence parity with v7.mjs, except for the documented
 * extension-only performance divergences below (working-resolution cap,
 * reduced FastVLM decode budget, tier-gated prewarm). Those change cost,
 * not detection outcomes: same models, same order, same fusion and gates.
 * Runs locally on dedicated GPU (NVIDIA RTX 4050) with integrated/CPU fallback
 */
import * as Ort from "onnxruntime-web";
import {
  AutoProcessor,
  AutoModelForImageTextToText,
  AutoTokenizer,
  AutoModelForTokenClassification,
  StoppingCriteria,
  load_image,
  env,
} from "@huggingface/transformers";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";

import { resolveComputeDevice, configureOrtEnvironment, getGpuErrorLog } from "./gpu.js";
import {
  cleanText,
  buildOCRGlobalSpans,
  buildReadingOrder,
  extractSensitiveFieldCandidates,
  fuseRedactionCandidates,
  selectT2ReviewCandidates,
  buildUIStructure,
  buildFindingsFromEntity,
  isPlaceholderText,
} from "./heuristics.js";
import {
  softmax,
  parseBioLabel,
  findEntitySpan,
  buildManualOffsetMapping,
  normalizeId2Label,
  mergeNERPredictions,
} from "./ner-utils.js";
import {
  buildFastVLMRedactionEvidence,
  buildCandidateCheckPrompt,
  buildTemplateCaption,
  buildPerceptionPrompt,
} from "./prompts.js";
import {
  extractJsonObject,
  validateFastVLMRedactionOutput,
  buildFastVLMFinalCandidates,
  resolveFinalRedactionRegions,
  applySafetyGates,
  adjudicateOrFallback,
  redactChunks,
  sanitizeCaption,
} from "./safety.js";
import { runFaceDetection } from "./face.js";
import { redactImageOnCanvas } from "./canvas-redactor.js";

/* ---------------- Pipeline Configuration Defaults ---------------- */

const FASTVLM_MODEL = "onnx-community/FastVLM-0.5B-ONNX";
const FASTVLM_DTYPE = {
  embed_tokens: "fp16",
  vision_encoder: "q4f16",
  decoder_model_merged: "q4f16",
};
// 512 tokens of greedy decode was never needed for the fixed JSON schema
// FastVLM returns (caption + a short redactions array) — 128 is generous
// headroom (Phase 1 optimization; was 160, shaved after the schema output
// on all fixtures validated well under 100 tokens) and cuts decode
// time/memory churn proportionally.
// NOTE (attribution): this and the fused-evidence prompt cap both shrink
// the decode/prefill workload — a FASTVLM latency drop in the live batch
// cannot be naively split between them. Read finding-count + validation
// status alongside latency: truncation harm shows up as invalid JSON
// (token cap), missing-evidence harm as fewer/weaker findings (prompt cap).
const FASTVLM_MAX_NEW_TOKENS = 128;

// Hang-guard around generate(), NOT a fail-fast: transformers generate()
// has no AbortSignal support (verified in @huggingface/transformers
// generation sources), so a timeout stops the pipeline WAITING — the
// underlying op keeps burning in the background. An abandoned op that
// overlaps the NEXT capture's generate is a ~1GB pile-up that OOM-kills
// the renderer (observed live 2026-09-28: timeouts at 01:35/03:08, then
// +1GB/run deltas and document deaths). Two consequences encoded below:
// (1) the value sits at 2x the slowest legitimate generate observed
// (61s), so it fires only on true hangs; (2) a firing arms a cooldown
// that keeps the next capture off the GPU while the orphan burns out.
// The aggressive direction (<=30s fail-fast) stays a human decision:
// natural ambiguous/text-heavy generates run 20-60s and would be
// amputated by it.
const FASTVLM_GENERATE_TIMEOUT_MS = 120_000;
// Cooldown after an abandoned generate: skip T2 (fallback covers findings)
// while the orphan may still be burning. Prevents pile-up, not a fix for
// the un-cancellable op itself.
const FASTVLM_TIMEOUT_COOLDOWN_MS = 90_000;
let _fastvlmCooldownUntil = 0;

// Crop-check decode budget (T2 replan 2026-09-28): a binary verdict needs
// ~20 tokens; 48 is 2x headroom. Decode on iGPU is dispatch-overhead +
// GPU->CPU-sync bound per token, so this cap (vs the old 128-token essay)
// is the primary burn lever: worst case 48 steps instead of 128.
const FASTVLM_CANDIDATE_MAX_TOKENS = 48;
// Per-check wait bound: a legible crop + ~150-token prompt answers in
// ~10-20s on iGPU; 30s fires only on true hangs. Same orphan semantics
// as the 120s guard (no abort handle) — arms the same cooldown.
const FASTVLM_CANDIDATE_TIMEOUT_MS = 30_000;
// Native-res crop margin per side (locked 25%): short numeric spans
// ("3524") need surrounding context to be legible; clamped to the frame.
const T2_CROP_MARGIN = 0.25;
// Async-caption decode budget (2026-09-28): one scene sentence, non-blocking.
const CAPTION_MAX_TOKENS = 40;
const CAPTION_TIMEOUT_MS = 60_000;

// Verbose per-item OCR/NER/heuristics/finding dumps are useful when actively
// debugging the pipeline but are pure overhead (console + string building +
// PII in devtools) on every normal capture. Flip on locally when needed.
const PII_DEBUG = false;

// Serializes runExtensionPipeline: without this, two overlapping captures
// (popup + bridge firing together, or a double-clicked Capture button) each
// spin up OCR+NER+FastVLM concurrently, doubling peak memory with no signal
// to the user about why things froze.
let _pipelineRunning = false;

// Set unconditionally at module evaluation time (synchronous, runs on import —
// before offscreen.js's schedulePrewarm() idle callback or any RUN_PIPELINE
// message can fire). This is deliberately NOT deferred into configureOrtEnvironment()
// only, because @huggingface/transformers memoizes its local tokenizer_config.json
// existence check by (modelId, filename) — if that check ever runs once while
// env.allowLocalModels is still false (the browser default), the negative result
// is cached for the rest of the session and AutoTokenizer.from_pretrained will
// throw "Cannot read properties of undefined (reading 'tokenizer_class')" forever,
// even after allowLocalModels is later set to true.
if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  env.localModelPath = chrome.runtime.getURL("models/");
}

const NER_MODEL_LOCAL = "models/ettin-68m-nemotron-pii-onnx";
const NER_MODEL_REMOTE = "rulesentry-io/ettin-68m-nemotron-pii-onnx";
const NER_MAX_TOKENS = 512;
const NER_MIN_SCORE = 0.3;

let _ocrServiceCache = null;
let _nerCache = null;
let _fastvlmCache = null;
let _prewarmScheduled = false;

/**
 * Pre-warms the NER and FastVLM models during idle time.
 * Called by offscreen.js via requestIdleCallback after document load.
 * Also called automatically after the first successful pipeline run.
 * This eliminates cold-start model-load latency from the inference path.
 */
export async function _prewarmModels() {
  try {
    const computeDevice = await resolveComputeDevice();
    // MUST run before any model load: transformers.js defaults env.allowLocalModels
    // to false in browsers, and its internal tokenizer_config.json existence check
    // is memoized. If loadNER() runs even once before this, the negative existence
    // check gets cached forever and NER silently dies for the whole session.
    configureOrtEnvironment(Ort, env, computeDevice);

    // On integrated GPU / CPU tiers, NER (~274MB) + FastVLM (~780MB) together
    // approach or exceed shared system RAM before the user has even captured
    // anything. Only dedicated-GPU tiers get the full unconditional prewarm;
    // everyone else loads these two lazily on first real capture instead.
    const heavyPrewarmAllowed = computeDevice.tier === "dedicated";

    if (!heavyPrewarmAllowed) {
      console.log(`[PREWARM] Tier=${computeDevice.tier}: skipping NER/FastVLM prewarm (will load lazily on first capture).`);
      return;
    }

    if (!_nerCache) {
      console.log("[PREWARM] Pre-loading Ettin NER in background...");
      await loadNER(computeDevice).catch((e) => console.warn("[PREWARM] NER pre-warm failed:", e.message));
    }
    if (!_fastvlmCache) {
      console.log("[PREWARM] Pre-loading FastVLM 0.5B in background...");
      await loadFastVLM(computeDevice).catch((e) => console.warn("[PREWARM] FastVLM pre-warm failed:", e.message));
    }
  } catch (e) {
    console.warn("[PREWARM] Pre-warm aborted:", e.message);
  }
}

/**
 * Normalizes any image input to an ImageBitmap and ArrayBuffer
 */
export async function decodeImageInput(input) {
  let blob = null;
  let arrayBuffer = null;

  if (input instanceof Blob) {
    blob = input;
    arrayBuffer = await blob.arrayBuffer();
  } else if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
    blob = new Blob([input], { type: "image/png" });
  } else if (ArrayBuffer.isView(input)) {
    arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    blob = new Blob([arrayBuffer], { type: "image/png" });
  } else if (typeof input === "string") {
    // Data URL or object URL
    const res = await fetch(input);
    blob = await res.blob();
    arrayBuffer = await blob.arrayBuffer();
  } else {
    throw new Error("Unsupported image input type for decoding");
  }

  const imageBitmap = await createImageBitmap(blob);
  return {
    blob,
    arrayBuffer,
    imageBitmap,
    width: imageBitmap.width,
    height: imageBitmap.height,
  };
}

const MAX_WORKING_DIMENSION = 1600;

/**
 * Downscales an oversized capture before it enters OCR/NER/redaction.
 * Detection quality doesn't need 4K/5K input, and every stage downstream
 * (OCR detector, per-region canvas blur, popup<->offscreen transfer size)
 * scales with pixel count. Returns the original decoded object unchanged
 * when it's already under the cap.
 */
async function capWorkingResolution(decoded, maxDim = MAX_WORKING_DIMENSION) {
  const { width, height } = decoded;
  if (!width || !height || (width <= maxDim && height <= maxDim)) return decoded;

  const scale = Math.min(maxDim / width, maxDim / height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(decoded.imageBitmap, 0, 0, targetW, targetH);
  const resizedBlob = await canvas.convertToBlob({ type: "image/png" });
  const resizedBuffer = await resizedBlob.arrayBuffer();
  const resizedBitmap = await createImageBitmap(resizedBlob);

  console.log(`[PIPELINE] Capped working resolution ${width}x${height} -> ${targetW}x${targetH}`);

  return {
    blob: resizedBlob,
    arrayBuffer: resizedBuffer,
    imageBitmap: resizedBitmap,
    width: targetW,
    height: targetH,
  };
}

/**
 * Loads PaddleOCR Service with packaged local models if present
 */
async function loadOCRService() {
  if (_ocrServiceCache?.isInitialized?.()) return _ocrServiceCache;

  let modelConfig = V6_SMALL_MODEL;
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    // Parity with Node v7.mjs (V6_SMALL_MODEL): use the packaged SMALL
    // detector/recognizer, not medium. Do NOT point these at the medium
    // files — different backbones produce different boxes and text.
    const localDetection = chrome.runtime.getURL("models/paddleocr/detection/PP-OCRv6_small_det.ort");
    const localRecognition = chrome.runtime.getURL("models/paddleocr/recognition/PP-OCRv6_small_rec.ort");
    const localDict = chrome.runtime.getURL("models/paddleocr/recognition/ppocrv6_dict.txt");
    try {
      const head = await fetch(localDetection, { method: "HEAD" });
      if (head.ok) {
        modelConfig = {
          detection: localDetection,
          recognition: localRecognition,
          charactersDictionary: localDict,
        };
        console.log("[OCR] Using packaged local PaddleOCR models");
      }
    } catch {}
  }

  const service = new PaddleOcrService({
    model: modelConfig,
    recognition: {
      // per-box is more robust than per-line when detection boxes are
      // slightly off (browser canvas vs Node). Node canvas-native per-line
      // already drops to 8 boxes on same image in some runs; per-box keeps
      // all 14 top+bottom boxes and matches opencv's full-text. Keep threshold
      // at 0.5 to avoid gibberish, but per-box tolerates y-shifted crops better.
      strategy: "per-box",
      minimumConfidence: 0.5,
    },
    // No detection.maxSideLength override: library default "auto" matches
    // Node v7.mjs (s4.png 1011x663 -> 960x640 detection input on both).
    // Forcing 1600 here fed full-res input only in the extension.
    session: { executionProviders: ["wasm"] },
  });

  await service.initialize();
  _ocrServiceCache = service;
  console.log("[OCR] PaddleOCR initialized successfully");
  return service;
}

/**
 * Runs PaddleOCR on image bytes
 */
async function runOCR(imageArrayBuffer) {
  const service = await loadOCRService();
  const result = await service.recognize(imageArrayBuffer, { flatten: true });

  // Full per-region dump (including raw OCR text) is PII-in-devtools and
  // thousands of console lines on dense pages — keep it opt-in only.
  if (PII_DEBUG) {
    console.log(`[OCR-DEBUG] result.results count=${(result.results || []).length} text.length=${(result.text || "").length} confidence=${result.confidence}`);
    console.log(`[OCR-DEBUG] full text: '${result.text}'`);
    for (const r of (result.results || [])) {
      const b = r.box || {};
      console.log(`[OCR-DEBUG] bbox=[x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}] text='${r.text}' conf=${Number(r.confidence ?? 0).toFixed(3)} raw=${JSON.stringify(r)}`);
    }
  }

  const items = (result.results || [])
    .map((item, index) => ({
      id: `ocr_${index}`,
      text: cleanText(item.text),
      confidence: item.confidence,
      bbox: [
        item.box.x,
        item.box.y,
        item.box.x + item.box.width,
        item.box.y + item.box.height,
      ],
    }))
    .filter((item) => item.text);

  return {
    model: "ppu-paddle-ocr (PP-OCRv6-small)",
    text: cleanText(result.text),
    confidence: result.confidence,
    items,
  };
}

/**
 * Resolves Ettin NER model path
 */
async function resolveNERModelPath() {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    const local = chrome.runtime.getURL(NER_MODEL_LOCAL);
    try {
      const check = await fetch(`${local}/config.json`);
      if (check.ok) return local;
    } catch {}
  }
  return NER_MODEL_REMOTE;
}

let _nerLoadPromise = null;

/**
 * Loads Ettin NER model with WebGPU and automatic CPU fallback.
 * Promise-cached (same pattern as face.js's loadFaceDetector): a second
 * caller that arrives while a load is already in flight awaits that same
 * load instead of starting a redundant ~274MB second load.
 */
async function loadNER(computeDevice) {
  if (_nerCache) return _nerCache;
  if (_nerLoadPromise) return await _nerLoadPromise;

  _nerLoadPromise = (async () => {
    const modelId = await resolveNERModelPath();
    // transformers.js only accepts device "webgpu" | "wasm" — "cpu" throws
    // Unsupported device (seen live in offscreen). WASM single-thread is the
    // CPU execution path; the string "cpu" must never reach from_pretrained.
    const targetDevice = computeDevice.type === "webgpu" ? "webgpu" : "wasm";
    // Pin execution providers explicitly. The Ettin encoder takes int64 inputs,
    // which crash the threaded WASM build ("operation does not support unaligned
    // accesses" — seen in MV3 offscreen). WebGPU handles int64 natively, so it is
    // the primary EP; single-thread WASM is the CPU fallback (no SAB/atomics path).
    // iGPU A/B outcome 2026-09-28: the buffer-cache bucket modes +
    // validationMode:wgpuOnly from the ORT Web docs are NOT honored by the
    // bundled onnxruntime-web 1.29.0 — verified in dist source: the webgpu
    // EP branch accepts exactly one extra key (preferredLayout NCHW/NHWC)
    // and silently ignores the rest, so the A/B would have compared
    // identical sessions. Bare ["webgpu"] stands; re-check after an ORT
    // upgrade. preferredLayout stays default (matmul-dominated decoder
    // wants NCHW; NHWC helps vision only — parked experiment).
    const webgpuSessionOptions = { executionProviders: ["webgpu"] };
    const wasmSessionOptions = { executionProviders: ["wasm"], intraOpNumThreads: 1, interOpNumThreads: 1 };
    console.log(`[NER] Loading Ettin NER: ${modelId} (${targetDevice})`);

    let tokenizer;
    let model;

    try {
      tokenizer = await AutoTokenizer.from_pretrained(modelId);
      model = await AutoModelForTokenClassification.from_pretrained(modelId, {
        dtype: "fp32",
        model_file_name: "model",
        // Upstream repo is flat (model.onnx at root, no onnx/ subfolder —
        // verified via HF API siblings). The from_pretrained default
        // subfolder "onnx" 404s here; "" resolves to the repo root.
        subfolder: "",
        device: targetDevice,
        session_options: targetDevice === "webgpu" ? webgpuSessionOptions : wasmSessionOptions,
      });
      console.log(`[NER] Ettin NER sessions on EP: ${targetDevice === "webgpu" ? "webgpu" : "wasm/1-thread"}`);
    } catch (err) {
      console.warn(`[NER] NER load failed on ${targetDevice}:`, err.message);
      if (targetDevice === "webgpu") {
        console.log("[NER] Retrying Ettin NER on CPU/WASM fallback...");
        tokenizer = tokenizer || (await AutoTokenizer.from_pretrained(modelId));
        model = await AutoModelForTokenClassification.from_pretrained(modelId, {
          dtype: "fp32",
          model_file_name: "model",
          subfolder: "",
          device: "wasm",
          session_options: wasmSessionOptions,
        });
      } else {
        throw err;
      }
    }

    const id2label = normalizeId2Label(model.config?.id2label);
    const configuredMax = Number(model.config?.max_position_embeddings ?? NER_MAX_TOKENS);
    const maxTokens = Math.min(NER_MAX_TOKENS, configuredMax > 0 ? configuredMax : NER_MAX_TOKENS);

    _nerCache = { tokenizer, model, id2label, maxTokens };
    return _nerCache;
  })();

  try {
    return await _nerLoadPromise;
  } finally {
    _nerLoadPromise = null;
  }
}

/**
 * Runs Ettin NER on complete OCR text sequence - 100% v7.mjs parity
 */
async function runNER(ner, ocr) {
  const findings = [];
  const { text: sourceText, spans: ocrSpans } = buildOCRGlobalSpans(ocr);

  if (!sourceText || ocrSpans.length === 0) {
    console.log("[NER] No OCR text to process.");
    return findings;
  }

  console.log(`[NER] Running Ettin on full OCR text (${sourceText.length} chars, ${ocrSpans.length} regions)`);

  let encoded;
  let offsetMapping = null;

  try {
    encoded = await ner.tokenizer(sourceText, {
      truncation: true,
      max_length: ner.maxTokens,
      return_offsets_mapping: true,
    });
    if (encoded.offset_mapping) {
      offsetMapping = Array.from(encoded.offset_mapping, (pair) =>
        Array.isArray(pair) ? pair : [pair[0], pair[1]]
      );
    }
  } catch {
    encoded = await ner.tokenizer(sourceText, {
      truncation: true,
      max_length: ner.maxTokens,
    });
  }

  const tokenIds = Array.from(
    encoded.input_ids?.data ?? encoded.input_ids,
    Number
  );

  if (!offsetMapping) {
    offsetMapping = buildManualOffsetMapping(tokenIds, ner.tokenizer, sourceText);
  }

  const outputs = await ner.model(encoded);
  const dims = outputs.logits.dims.map(Number);
  const data = outputs.logits.data;
  const sequenceLength = dims[1];
  const numberOfLabels = dims[2];

  const predictions = [];
  const tokenTexts = [];

  for (let i = 0; i < tokenIds.length; i++) {
    try {
      tokenTexts[i] = ner.tokenizer.decode([tokenIds[i]], {
        skip_special_tokens: true,
      });
    } catch {
      tokenTexts[i] = "";
    }
  }

  for (let tokenIndex = 0; tokenIndex < Math.min(sequenceLength, tokenIds.length); tokenIndex++) {
    const row = new Array(numberOfLabels);
    for (let labelIndex = 0; labelIndex < numberOfLabels; labelIndex++) {
      row[labelIndex] = Number(data[tokenIndex * numberOfLabels + labelIndex]);
    }

    const probabilities = softmax(row);
    let bestLabel = 0;
    let bestScore = probabilities[0];
    for (let i = 1; i < numberOfLabels; i++) {
      if (probabilities[i] > bestScore) {
        bestScore = probabilities[i];
        bestLabel = i;
      }
    }

    predictions.push({
      tokenIndex,
      label: ner.id2label[bestLabel] ?? `LABEL_${bestLabel}`,
      score: bestScore,
      sourceText,
    });
  }

  const entities = mergeNERPredictions(
    predictions,
    tokenIds,
    ner.tokenizer,
    offsetMapping,
    tokenTexts
  );

  console.log(`[NER] Detected ${entities.length} entities in full text.`);

  for (const entity of entities) {
    if (isPlaceholderText(entity.text)) continue;

    let entityStart = entity.start;
    let entityEnd = entity.end;

    if (entityStart === null || entityEnd === null) {
      const span = findEntitySpan(sourceText, entity.text);
      entityStart = span.start;
      entityEnd = span.end;
    }

    if (entityStart === null || entityEnd === null) {
      console.warn(`[WARN] Could not locate entity "${entity.text}" in OCR text`);
      continue;
    }

    const entityFindings = buildFindingsFromEntity(
      entity,
      ocrSpans,
      entity.entity
    );

    for (const finding of entityFindings) {
      findings.push({
        source_id: finding.source_id,
        entity: finding.entity,
        score: finding.score,
        text: finding.text,
        bbox: finding.bbox,
        start: finding.start,
        end: finding.end,
      });
    }
  }

  return findings;
}

// GPU-side ImageBitmaps and ORT tensors are not GC-prompt: a 1600px working
// bitmap (~10MB) and per-inference vision/prefill tensors linger until a
// major GC, so back-to-back captures stack them into the spikes users see.
// Both helpers are no-ops on anything without the method (test stubs, already
// released handles) and never throw into the pipeline.
function closeBitmap(bitmap) {
  try {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  } catch {}
}

function disposeTensors(bag) {
  if (!bag || typeof bag !== "object") return;
  for (const value of Object.values(bag)) {
    try {
      value?.dispose?.();
    } catch {}
  }
}

let _fastvlmLoadPromise = null;

/**
 * Loads FastVLM 0.5B Multimodal model with WebGPU / CPU backend.
 * Promise-cached like loadNER/loadFaceDetector.
 *
 * NOTE: this deliberately does NOT retry on WASM after a webgpu failure.
 * The old retry path re-attempted the same ~780MB decoder on single-thread
 * WASM, which is the single biggest crash vector on integrated/shared-memory
 * GPUs (near-certain hang, not a graceful fallback). Callers already treat a
 * thrown/rejected load as "FastVLM unavailable" and fall back to
 * text+heuristics-only adjudication (fusion_fallback), which is the correct
 * behavior on these tiers rather than freezing the machine trying to recover.
 */
async function loadFastVLM(computeDevice) {
  if (_fastvlmCache) return _fastvlmCache;
  if (_fastvlmLoadPromise) return await _fastvlmLoadPromise;

  _fastvlmLoadPromise = (async () => {
    // Same constraint as loadNER: transformers.js accepts only
    // "webgpu" | "wasm" — "cpu" throws Unsupported device.
    const device = computeDevice.type === "webgpu" ? "webgpu" : "wasm";
    const sessionOptions = { executionProviders: device === "webgpu" ? ["webgpu"] : ["wasm"] };
    console.log(`[FASTVLM] Loading FastVLM 0.5B on ${computeDevice.label} (device: ${device})`);

    const processor = await AutoProcessor.from_pretrained(FASTVLM_MODEL);
    const model = await AutoModelForImageTextToText.from_pretrained(FASTVLM_MODEL, {
      dtype: FASTVLM_DTYPE,
      device,
      session_options: sessionOptions,
    });
    if (PII_DEBUG) console.log("[FASTVLM-DEBUG] sessions:", Object.keys(model.sessions || {}));

    _fastvlmCache = {
      model,
      processor,
      modelId: FASTVLM_MODEL,
      device,
      backend: computeDevice.label,
    };
    console.log(`[FASTVLM] Loaded FastVLM 0.5B successfully on ${_fastvlmCache.backend}`);
    return _fastvlmCache;
  })();

  try {
    return await _fastvlmLoadPromise;
  } finally {
    _fastvlmLoadPromise = null;
  }
}

/**
 * Crops a candidate bbox (±T2_CROP_MARGIN, clamped) at NATIVE working
 * resolution. The retired full-page path downscaled dense pages to 448px,
 * smearing 14px text to ~4px — T2 was blind by construction and answered
 * with layout prose ("Indian ID" that isn't there). A ~200x60px native
 * crop is tiny prefill AND legible. Coordinates are working-res
 * (decoded.blob is capped by capWorkingResolution, bboxes map 1:1).
 * Degenerate boxes fall back to the full frame rather than throwing.
 */
async function cropCandidateImage(imageBlob, bbox, imageW, imageH) {
  const bitmap = await createImageBitmap(imageBlob);
  try {
    const nums = (bbox || []).map(Number);
    const bx1 = Number.isFinite(nums[0]) ? nums[0] : 0;
    const by1 = Number.isFinite(nums[1]) ? nums[1] : 0;
    const bx2 = Number.isFinite(nums[2]) ? nums[2] : imageW;
    const by2 = Number.isFinite(nums[3]) ? nums[3] : imageH;
    const w = Math.max(1, bx2 - bx1);
    const h = Math.max(1, by2 - by1);
    const mx = w * T2_CROP_MARGIN;
    const my = h * T2_CROP_MARGIN;
    const cx = Math.max(0, Math.floor(bx1 - mx));
    const cy = Math.max(0, Math.floor(by1 - my));
    const cw = Math.min(imageW - cx, Math.ceil(w + mx * 2));
    const ch = Math.min(imageH - cy, Math.ceil(h + my * 2));
    if (cw < 2 || ch < 2) return imageBlob;
    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext("2d").drawImage(bitmap, cx, cy, cw, ch, 0, 0, cw, ch);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    closeBitmap(bitmap);
  }
}

/**
 * Early-exit decode guard (the JSON-completion exit): stop the moment the
 * verdict object is brace-balanced and ends with }. Subclasses the
 * package-root StoppingCriteria (public surface; verified against the
 * vendored bundle — generate() ORs custom criteria per batch, so a
 * single [true] stops decode). decode() per step is CPU-trivial next to
 * a GPU decode step. minNewTokens guards degenerate instant stops; any
 * throw inside _call returns [false] (a throwing criterion would abort
 * the whole generate, so this degrades to the 48-token cap, never worse).
 */
class BalancedJsonStoppingCriteria extends StoppingCriteria {
  constructor(decodeFn, promptLength, minNewTokens = 8) {
    super();
    this.decodeFn = decodeFn;
    this.promptLength = promptLength;
    this.minNewTokens = minNewTokens;
  }
  _call(input_ids, _scores) {
    try {
      const ids = (input_ids?.[0] || []).slice(this.promptLength).map(Number);
      if (ids.length < this.minNewTokens) return [false];
      const text = this.decodeFn(ids);
      let depth = 0;
      let seen = false;
      for (const ch of text) {
        if (ch === "{") { depth++; seen = true; }
        else if (ch === "}") depth--;
      }
      return [seen && depth <= 0 && text.trimEnd().endsWith("}")];
    } catch {
      return [false];
    }
  }
}

/**
 * One legible question about one crop: span + line context in, binary
 * verdict out (<=48 tokens). Serialized by the caller (pile-up lesson);
 * same orphan semantics as the old guard (no abort handle exists, so a
 * timeout arms the shared cooldown instead of cancelling).
 */
async function runFastVLMCandidateCheck({ fastvlm, cropBlob, prompt }) {
  const cropImage = await load_image(cropBlob);
  const messages = [{ role: "user", content: `<image>${prompt}` }];
  const rendered = fastvlm.processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  // Assistant prefill (carried over from the retired call): forces a JSON
  // start so the 0.5B never leads with "The image shows..." prose.
  const renderedForced = `${rendered}{`;
  const inputs = await fastvlm.processor(cropImage, renderedForced, {
    add_special_tokens: false,
  });
  const inputLength = Number(inputs?.input_ids?.dims?.at(-1) ?? 0);
  let criteria = null;
  try {
    criteria = new BalancedJsonStoppingCriteria(
      (ids) => fastvlm.processor.batch_decode([ids], { skip_special_tokens: true })[0] ?? "",
      inputLength
    );
  } catch {
    criteria = null;
  }
  const genArgs = {
    ...inputs,
    max_new_tokens: FASTVLM_CANDIDATE_MAX_TOKENS,
    do_sample: false,
    repetition_penalty: 1.05,
  };
  if (criteria) genArgs.stopping_criteria = [criteria];
  const generatePromise = fastvlm.model.generate(genArgs);
  // Swallow the loser's late rejection (same race pattern as retired call).
  generatePromise.catch(() => {});
  let generated;
  try {
    generated = await Promise.race([
      generatePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`FastVLM candidate check timed out after ${FASTVLM_CANDIDATE_TIMEOUT_MS}ms`)), FASTVLM_CANDIDATE_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    if (String(err?.message || "").includes("timed out")) {
      _fastvlmCooldownUntil = Date.now() + FASTVLM_TIMEOUT_COOLDOWN_MS;
      console.warn(`[FASTVLM] Candidate check timeout — cooling down T2 for ${FASTVLM_TIMEOUT_COOLDOWN_MS / 1000}s (orphaned op still burning)`);
    }
    throw err;
  }

  const inputLengthSnapshot = inputLength;
  disposeTensors(inputs);

  let outputText = "";
  let generatedOnly = null;
  try {
    generatedOnly = inputLengthSnapshot > 0 ? generated.slice(null, [inputLengthSnapshot, null]) : generated;
    outputText = fastvlm.processor.batch_decode(generatedOnly, { skip_special_tokens: true })[0] ?? "";
  } catch {
    outputText = fastvlm.processor.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
  } finally {
    if (generatedOnly && generatedOnly !== generated) disposeTensors({ generatedOnly });
    disposeTensors({ generated });
  }

  // Restore the prefilled brace (same convention as the retired call).
  outputText = String(outputText).trim();
  if (outputText && !outputText.startsWith("{")) outputText = `{${outputText}`;
  if (!outputText) throw new Error("FastVLM candidate check generated an empty response");
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(outputText));
  } catch (err) {
    throw new Error(`FastVLM candidate check JSON parse failed: ${err.message} :: ${outputText.slice(0, 80)}`);
  }
  const verdict = String(parsed?.verdict || "").toLowerCase();
  if (verdict !== "yes" && verdict !== "no") {
    throw new Error(`FastVLM candidate check verdict not binary: ${outputText.slice(0, 80)}`);
  }
  return { verdict, confidence: Number(parsed?.confidence ?? 0.5), raw: outputText };
}

/**
 * Serialized per-LOW-candidate review (cap N=6, lowest-confidence-first —
 * selection happened in selectT2ReviewCandidates). One model load, one
 * generate at a time: transformers.js chains WebGPU inference globally,
 * so concurrency buys nothing and risks everything.
 *
 * Returns status "candidate_checks" (all decided) or "partial" (some
 * errored — errored/unchecked stay in the fallback via fail-closed).
 * Throws only when EVERYTHING failed (load or all checks), so the caller
 * takes the load_failed path with the FULL list — a T2 failure must
 * never mean less protection. Confirmed candidates carry _t2_confirmed
 * (Gate 6 clears them at 0.5 honestly); clean rejects are the caller's
 * to remove ("logged drop").
 */
async function runFastVLMCandidateChecks({ imageBlob, imageW, imageH, reviewCandidates, ocrItems, computeDevice }) {
  // Post-timeout cooldown (same guard as the retired call): an abandoned
  // op may still be burning — fail over, don't pile on.
  if (Date.now() < _fastvlmCooldownUntil) {
    throw new Error("FastVLM cooling down after abandoned generate (timeout pile-up guard)");
  }
  const fastvlm = await loadFastVLM(computeDevice);
  const confirmed = [];
  const rejected = [];
  const errored = [];
  for (const c of reviewCandidates) {
    const lineText =
      (ocrItems || [])
        .filter((o) => (c.ocr_ids || []).includes(o.id))
        .map((o) => o.text)
        .join(" ") || String(c.text || "");
    const prompt = buildCandidateCheckPrompt(c, lineText);
    try {
      const cropBlob = await cropCandidateImage(imageBlob, c.bbox, imageW, imageH);
      const { verdict, confidence } = await runFastVLMCandidateCheck({ fastvlm, cropBlob, prompt });
      if (verdict === "yes") {
        c._t2_confirmed = true;
        c._t2_confidence = confidence;
        confirmed.push(c.candidate_id);
        console.log(`[FASTVLM] crop check CONFIRM ${c.candidate_id} '${String(c.text).slice(0, 40)}' t2conf=${confidence}`);
      } else {
        rejected.push(c.candidate_id);
        console.log(`[FASTVLM] crop check reject ${c.candidate_id} '${String(c.text).slice(0, 40)}'`);
      }
    } catch (err) {
      console.warn(`[FASTVLM] crop check error ${c.candidate_id}: ${err.message}`);
      errored.push(c.candidate_id);
    }
  }
  if (errored.length > 0 && confirmed.length === 0 && rejected.length === 0) {
    throw new Error(`All ${reviewCandidates.length} FastVLM crop checks failed`);
  }
  return {
    status: errored.length === 0 ? "candidate_checks" : "partial",
    confirmed,
    rejected,
    errored,
  };
}

/**
 * Async VLM caption on the ALREADY-REDACTED image (2026-09-28, user's
 * corrected architecture). Runs strictly after output delivery — never on
 * the critical path. Redacted pixels can't leak, so this prompt carries
 * no constraints, no rule 10, no scrubbing: "describe this image" is the
 * whole instruction, and whatever prose comes back is safe by
 * construction. Skips (template stands) while a T2 cooldown is armed or
 * the model is unreachable — caption is UI sugar, never load-bearing.
 * Scene-level only: downscaled to 448px like the retired call.
 */
export async function generateCaptionOnRedactedImage(redactedBlob, computeDevice) {
  if (Date.now() < _fastvlmCooldownUntil) {
    throw new Error("caption skipped: T2 cooling down after abandoned generate");
  }
  const device = computeDevice && computeDevice.type === "webgpu" ? computeDevice : { type: "webgpu", label: "caption" };
  const fastvlm = await loadFastVLM(device);
  const bitmap = await createImageBitmap(redactedBlob);
  let frameBlob = redactedBlob;
  try {
    const max = 448;
    if (bitmap.width > max || bitmap.height > max) {
      const scale = Math.min(max / bitmap.width, max / bitmap.height);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      frameBlob = await canvas.convertToBlob({ type: "image/png" });
    }
  } finally {
    closeBitmap(bitmap);
  }
  const image = await load_image(frameBlob);
  const messages = [{ role: "user", content: "<image>Describe this image briefly in one sentence." }];
  const rendered = fastvlm.processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await fastvlm.processor(image, rendered, { add_special_tokens: false });
  const inputLength = Number(inputs?.input_ids?.dims?.at(-1) ?? 0);
  const generatePromise = fastvlm.model.generate({
    ...inputs,
    max_new_tokens: CAPTION_MAX_TOKENS,
    do_sample: false,
    repetition_penalty: 1.05,
  });
  generatePromise.catch(() => {});
  let generated;
  try {
    generated = await Promise.race([
      generatePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`caption generate timed out after ${CAPTION_TIMEOUT_MS}ms`)), CAPTION_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    if (String(err?.message || "").includes("timed out")) {
      _fastvlmCooldownUntil = Date.now() + FASTVLM_TIMEOUT_COOLDOWN_MS;
    }
    throw err;
  }
  disposeTensors(inputs);
  let text = "";
  try {
    const generatedOnly = inputLength > 0 ? generated.slice(null, [inputLength, null]) : generated;
    text = fastvlm.processor.batch_decode(generatedOnly, { skip_special_tokens: true })[0] ?? "";
    if (generatedOnly && generatedOnly !== generated) disposeTensors({ generatedOnly });
  } catch {
    text = fastvlm.processor.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
  } finally {
    disposeTensors({ generated });
  }
  text = String(text).replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) throw new Error("caption generate returned empty text");
  return text;
}

/**
 * Main Pipeline Entry Point for Chrome Extension
 * @param {Blob|ArrayBuffer|string} inputImage
 * @param {Object} options
 * @param {Function} onProgress
 */
export async function runExtensionPipeline(inputImage, options = {}, onProgress = null) {
  // Concurrent-run guard: two overlapping runs (popup + bridge firing
  // together, or a double-clicked Capture button) previously drove OCR+NER
  // +FastVLM concurrently, doubling peak memory with no mutex. Fail fast
  // and honest instead of silently racing model loads — both callers
  // (popup RUN_PIPELINE handler, bridge capture_tab route) already turn a
  // throw here into an honest error response.
  if (_pipelineRunning) {
    throw new Error("PerScope: a capture is already in progress. Please wait for it to finish.");
  }
  _pipelineRunning = true;

  try {
    return await _runExtensionPipelineInner(inputImage, options, onProgress);
  } finally {
    _pipelineRunning = false;
  }
}

/* Benchmark instrumentation (additive only — never alters control flow).
   Stage marks piggyback the existing progress emit() calls, so per-stage
   latency and tier-escalation tracking cost nothing at runtime and cannot
   change pipeline behavior. heapSample() is guarded: non-Chromium
   runtimes get memory:null instead of a throw. */
function heapSample() {
  try {
    const mem = performance.memory;
    if (mem && typeof mem.usedJSHeapSize === "number") {
      return { usedJSHeap: mem.usedJSHeapSize, totalJSHeap: mem.totalJSHeapSize };
    }
  } catch {}
  return null;
}

function buildStagePerf(marks) {
  const starts = new Map();
  const out = [];
  for (const m of marks) {
    if (m.status === "START") {
      if (!starts.has(m.stage)) starts.set(m.stage, m.at);
    } else if (m.status === "SKIPPED") {
      out.push({ stage: m.stage, status: "skipped", ms: null });
      starts.delete(m.stage);
    } else if (m.status === "DONE" || m.status === "ERROR") {
      const s = starts.get(m.stage);
      out.push({
        stage: m.stage,
        status: m.status === "DONE" ? "done" : "error",
        ms: s !== undefined ? Math.round(m.at - s) : null,
        info: typeof m.info === "string" ? m.info : null,
      });
      starts.delete(m.stage);
    }
  }
  for (const [stage] of starts) out.push({ stage, status: "open", ms: null });
  return out;
}

async function _runExtensionPipelineInner(inputImage, options = {}, onProgress = null) {
  const tTotalStart = performance.now();
  const memBefore = heapSample();
  const stageMarks = [];
  const emit = (stage, status, extra = {}) => {
    try {
      // info is a size-capped copy of the progress payload (counts, not
      // content) so stage records are self-diagnosing: itemsCount next to
      // ms exposes fast-path vs measurement artifacts without new hooks.
      let info;
      try {
        info = JSON.stringify(extra || {}).slice(0, 500);
      } catch {
        info = null;
      }
      stageMarks.push({ stage, status, at: performance.now(), info });
      onProgress?.({ stage, status, ...extra });
    } catch {}
  };

  emit("INIT", "START");

  // 1. Device Resolution (Dedicated GPU -> Integrated GPU -> CPU Fallback)
  emit("DEVICE", "START");
  const computeDevice = await resolveComputeDevice(options.forceDeviceTier || null);
  configureOrtEnvironment(Ort, env, computeDevice);
  emit("DEVICE", "DONE", { tier: computeDevice.tier });

  // 2. Decode Image
  emit("IMAGE_DECODE", "START");
  let decoded = await decodeImageInput(inputImage);
  decoded = await capWorkingResolution(decoded);
  emit("IMAGE_DECODE", "DONE", { width: decoded.width, height: decoded.height });

  /* ---------------- FACE DETECTION ---------------- */
  let faceFindings = [];
  const faceEnabled = options.faceEnabled !== false;

  if (faceEnabled) {
    emit("FACE", "START");
    try {
      faceFindings = await runFaceDetection(decoded.imageBitmap, {
        minConfidence: options.faceMinConfidence ?? 0.60,
        iouThreshold: options.faceIouThreshold ?? 0.30,
        maxDetections: options.faceMaxDetections ?? 25,
        redactionStyle: options.faceRedactionStyle || options.redactionStyle || "blur",
      });
      emit("FACE", "DONE", { count: faceFindings.length, faces: faceFindings });
    } catch (err) {
      console.warn("[WARN] Face detection failed:", err.message);
      emit("FACE", "ERROR", { error: err.message });
      faceFindings = [];
    }
  } else {
    emit("FACE", "SKIPPED", { reason: "Face disabled by user" });
  }

  /* ---------------- OCR ---------------- */
  emit("OCR", "START");
  const ocr = await runOCR(decoded.arrayBuffer);
  const readingOrder = buildReadingOrder(ocr);
  emit("OCR", "DONE", { itemsCount: ocr.items?.length || 0 });

  /* ---------------- NER ---------------- */
  emit("NER", "START");
  let nerFindings = [];
  try {
    console.log("[NER] Attempting to load Ettin NER model...");
    const ner = await loadNER(computeDevice);
    console.log("[NER] Ettin NER model loaded. Running inference...");
    nerFindings = await runNER(ner, ocr);
    console.log(`[NER] runNER complete: ${nerFindings.length} findings`);
    if (PII_DEBUG) {
      for (const f of nerFindings) {
        console.log(`[NER] finding: entity=${f.entity} text='${f.text}' score=${Number(f.score).toFixed(3)} source=${f.source_id}`);
      }
    }
    emit("NER", "DONE", { count: nerFindings.length, findings: nerFindings.map(f => ({ entity: f.entity, text: f.text, score: f.score })) });
  } catch (err) {
    console.warn("[WARN] Ettin NER failed:", err.message, err.stack);
    emit("NER", "ERROR", { error: err.message });
    nerFindings = [];
  }

  /* ---------------- DETERMINISTIC HEURISTICS ---------------- */
  emit("HEURISTICS", "START");
  const deterministicFindings = extractSensitiveFieldCandidates(ocr);
  const fusedCandidates = fuseRedactionCandidates({
    ettinFindings: nerFindings,
    deterministicFindings,
  });
  console.log(`[HEURISTICS] deterministicFindings=${deterministicFindings.length} fusedCandidates=${fusedCandidates.length}`);
  // Content-free fusion trace (always on): candidate shape without values —
  // this is what tells HIGH-apart from LOW-apart from dropped at the gate.
  for (const c of fusedCandidates) {
    console.log(`[TRACE] fused ${c.candidate_id}[${(c.candidate_types || []).join("+")}|${(c.sources || []).join("+")}|${Number(c.confidence ?? 0).toFixed(2)}|len=${String(c.text ?? "").length}|ocr=${(c.ocr_ids || []).length}]`);
  }
  if (PII_DEBUG) {
    for (const c of fusedCandidates) {
      console.log(`[HEURISTICS] candidate: ${c.candidate_id} text='${c.text}' types=${c.candidate_types.join('+')} sources=${c.sources.join('+')} conf=${Number(c.confidence).toFixed(3)}`);
    }
  }

  const uiStructure = buildUIStructure({
    image: decoded,
    ocr,
    fastvlm: null,
  });

  const fastvlmEvidence = buildFastVLMRedactionEvidence({
    image: decoded,
    ocr,
    ettinFindings: nerFindings,
    deterministicFindings,
    fusedCandidates,
  });
  emit("HEURISTICS", "DONE", {
    deterministicCount: deterministicFindings.length,
    fusedCount: fusedCandidates.length,
    nerCount: nerFindings.length,
  });

    /* ---------------- FASTVLM 0.5B ADJUDICATION (gated crop checks) ---------------- */
  // Gate (T2 replan 2026-09-28): T2 fires IFF low-confidence entities exist
  // (single-source below H). Clean pages skip with zero T2 cost — and skip
  // one more chance to wedge the global webInferenceChain. HIGH findings
  // never see the model. The retired full-page call is deleted (was blind
  // at 448px by construction); LOW candidates get native-res crop checks.
  const fastvlmEnabled = options.fastvlmEnabled !== false;
  const { high: highConfCandidates, low: reviewCandidates, droppedLow } =
    selectT2ReviewCandidates(fusedCandidates);
  let fastvlmResult = null;
  // Adjudication input: HIGH + T2-confirmed + errored/over-cap survive;
  // clean T2 rejects are removed ("logged drop"). Full-list fallback only
  // when T2 itself fails (fail-closed keeps >=F, never less protection).
  let adjudicationCandidates = fusedCandidates;

  if (!fastvlmEnabled) {
    emit("FASTVLM", "SKIPPED", { reason: "FastVLM disabled by user" });
    fastvlmResult = {
      status: "skipped",
      reason: "FastVLM disabled by user",
      raw: JSON.stringify({ status: "skipped" }),
    };
  } else if (reviewCandidates.length === 0) {
    emit("FASTVLM", "SKIPPED", {
      reason: "No low-confidence candidates (gate)",
      highCount: highConfCandidates.length,
    });
    console.log(`[FASTVLM] Gate closed: ${highConfCandidates.length} HIGH, 0 LOW — T2 skipped`);
    console.log(`[TRACE] HIGH: ${highConfCandidates.map((c) => c.candidate_id).join(",") || "(none)"}`);
    fastvlmResult = {
      status: "skipped",
      reason: "No low-confidence candidates (gate)",
      raw: JSON.stringify({ status: "skipped" }),
    };
  } else {
    emit("FASTVLM", "START", {
      checks: reviewCandidates.length,
      high: highConfCandidates.length,
      droppedLow,
    });
    console.log(`[FASTVLM] Gate open: ${highConfCandidates.length} HIGH direct, ${reviewCandidates.length} LOW crop checks${droppedLow ? ` (${droppedLow} over cap, kept in fallback)` : ""}`);
    console.log(`[TRACE] HIGH: ${highConfCandidates.map((c) => c.candidate_id).join(",") || "(none)"} LOW: ${reviewCandidates.map((c) => c.candidate_id).join(",")}`);
    try {
      const checks = await runFastVLMCandidateChecks({
        imageBlob: decoded.blob,
        imageW: decoded.width,
        imageH: decoded.height,
        reviewCandidates,
        ocrItems: ocr.items,
        computeDevice,
      });
      const rejectSet = new Set(checks.rejected);
      adjudicationCandidates = fusedCandidates.filter((c) => !rejectSet.has(c.candidate_id));
      fastvlmResult = {
        status: checks.status,
        reason: `crop checks: ${checks.confirmed.length} confirmed, ${checks.rejected.length} rejected, ${checks.errored.length} errored`,
        raw: "",
        confirmed: checks.confirmed,
        rejected: checks.rejected,
        errored: checks.errored,
      };
      emit("FASTVLM", "DONE", {
        status: checks.status,
        confirmed: checks.confirmed.length,
        rejected: checks.rejected.length,
        errored: checks.errored.length,
      });
    } catch (err) {
      console.warn("[WARN] FastVLM crop checks failed:", err.message);
      fastvlmResult = {
        status: "load_failed",
        reason: err.message,
        raw: JSON.stringify({ status: "load_failed", reason: err.message }),
      };
      emit("FASTVLM", "ERROR", { error: err.message });
    }
  }

/* ---------------- SAFETY & ADJUDICATION FALLBACK ---------------- */
  const adjudication = adjudicateOrFallback({
    ettinFindings: nerFindings,
    deterministicFindings,
    fusedCandidates: adjudicationCandidates,
    fastvlmResult,
    evidence: {
      fastvlm_evidence: fastvlmEvidence,
    },
    image: decoded,
  });

  const finalTextFindings = adjudication.finalFindings || [];
  console.log(`[ADJUDICATION] status=${adjudication.status} fallback=${adjudication.fallback} finalTextFindings=${finalTextFindings.length}`);
  if (PII_DEBUG) {
    for (const f of finalTextFindings) {
      console.log(`[ADJUDICATION] final: entity=${f.entity} text='${f.text}' score=${Number(f.score).toFixed(3)} decision=${f.decision_source}`);
    }
  }
  const finalFindings = [...finalTextFindings, ...faceFindings];

  /* ---------------- IMAGE REDACTION (CANVAS) ---------------- */
  emit("REDACT", "START", { regionsCount: finalFindings.length });
  const rawChunks = (ocr.items || []).map((item) => ({
    id: item.id,
    text: item.text,
    bbox: item.bbox ?? null,
    confidence: item.confidence,
  }));

  const redactedChunks = redactChunks(rawChunks, finalTextFindings);
  const redactedOcrText = redactedChunks.map((c) => c.text).join(" ");

  let imageRedaction;
  try {
    imageRedaction = await redactImageOnCanvas(decoded.imageBitmap, finalFindings, {
      style: options.redactionStyle || "blur",
      faceStyle: options.faceRedactionStyle || options.redactionStyle || "blur",
      padding: options.padding ?? 2,
      facePadding: options.facePadding ?? 3,
      textBlurSigma: options.textBlurSigma ?? 12,
      faceBlurSigma: options.faceBlurSigma ?? 14,
    });
  } finally {
    // Same release as the success path: a redaction throw must not leave a
    // GPU bitmap behind on top of the failed capture.
    closeBitmap(decoded.imageBitmap);
  }
  emit("REDACT", "DONE", {
    textRegions: imageRedaction.textRegionsRedacted,
    faceRegions: imageRedaction.faceRegionsRedacted,
  });

  const totalTimeMs = Math.round(performance.now() - tTotalStart);
  // Post-cleanup sample: bitmaps are closed in the redact finally-block
  // above, so this is the steady number — residue here is a leak signal.
  const memAfter = heapSample();

  // Centralized display caption: template-first architecture (2026-09-28).
  // The template is instant, deterministic and unleakable (counts/types
  // only) — it ships on the fast path so output never waits for the model.
  // The legacy VLM-caption producers are gone (full-page call deleted, crop
  // checks emit verdicts not prose); the async VLM caption, when requested,
  // arrives later via CAPTION_RESULT and upgrades this string in the UI.
  const templateCaption = buildTemplateCaption({
    width: decoded.width,
    height: decoded.height,
    finalFindings,
    faceCount: faceFindings.length,
  });
  const legacyCaption = sanitizeCaption(fastvlmResult?.parsed?.caption || "", fastvlmEvidence) || null;
  const safeCaption = legacyCaption || templateCaption;
  const captionSource = legacyCaption ? "fastvlm" : "template";

  // Assemble comprehensive evidence schema (100% v7.mjs parity)
  const evidenceOutput = {
    input_mode: {
      image: true,
      dom: false,
    },
    compute_device: computeDevice,
    image: {
      width: decoded.width,
      height: decoded.height,
    },
    global_description: {
      caption: safeCaption,
      source: captionSource,
      model: FASTVLM_MODEL,
      status: fastvlmResult?.status ?? "unknown",
      captionPending: options.asyncCaption === true,
    },
    florence: {
      description: safeCaption ?? "",
      caption: safeCaption ?? "",
      source: captionSource,
      model: FASTVLM_MODEL,
    },
    ocr: {
      ...ocr,
      reading_order: readingOrder.ordered.map((o) => ({
        id: o.id,
        reading_order: o.reading_order,
        bbox: o.bbox,
      })),
    },
    ui_structure: uiStructure,
    face_detection: {
      enabled: faceEnabled,
      model: "garavv/blazeface-onnx",
      faces: faceFindings,
      count: faceFindings.length,
    },
    image_redaction: {
      ...imageRedaction,
      status: adjudication.status,
      redaction_complete: adjudication.redaction_complete,
      fallback: adjudication.fallback,
    },
    ner: {
      model: NER_MODEL_LOCAL,
      sequence_mode: "full_ocr_text",
      source_text_length: ocr.text?.length ?? 0,
      findings: nerFindings,
    },
    deterministic_context: {
      findings: deterministicFindings,
    },
    candidate_fusion: {
      candidates: fusedCandidates,
    },
    fastvlm_adjudication: {
      model: FASTVLM_MODEL,
      enabled: fastvlmEnabled,
      status: fastvlmResult?.status ?? "unknown",
      redaction_complete: adjudication.redaction_complete,
      fallback: adjudication.fallback,
      raw: fastvlmResult?.raw ? String(fastvlmResult.raw).slice(0, 2000) : null,
      parsed: fastvlmResult?.parsed ?? null,
      validation: adjudication.validation ?? null,
      caption: safeCaption,
      redactions: fastvlmResult?.parsed?.redactions ?? [],
      rejected_candidates: fastvlmResult?.parsed?.rejected_candidates ?? [],
      reason: fastvlmResult?.reason ?? null,
    },
    fastvlm_evidence: fastvlmEvidence,
    final_findings: finalFindings,
    redaction: {
      chunks: redactedChunks,
      redacted_ocr_text: redactedOcrText,
      entity_types_found: [...new Set(finalFindings.map((f) => f.entity))],
      adjudication_status: adjudication.status,
      redaction_complete: adjudication.redaction_complete,
    },
    pipeline_perf: {
      totalTimeMs,
      stages: buildStagePerf(stageMarks),
      memory: { before: memBefore, after: memAfter },
      gpuEvents: getGpuErrorLog(),
      build: (typeof globalThis !== "undefined" && globalThis.__PERSCOPE_BUILD) || null,
    },
  };

  const perceptionPrompt = buildPerceptionPrompt(evidenceOutput);

  return {
    outputBlob: imageRedaction.blob,
    evidence: evidenceOutput,
    perceptionPrompt,
    computeDevice,
    totalTimeMs,
  };
}
