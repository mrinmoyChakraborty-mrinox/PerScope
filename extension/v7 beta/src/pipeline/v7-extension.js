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
  load_image,
  env,
} from "@huggingface/transformers";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";

import { resolveComputeDevice, configureOrtEnvironment } from "./gpu.js";
import {
  cleanText,
  buildOCRGlobalSpans,
  buildReadingOrder,
  extractSensitiveFieldCandidates,
  fuseRedactionCandidates,
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
  buildFastVLMRedactionPrompt,
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
// FastVLM returns (caption + a short redactions array) — 160 is generous
// headroom and roughly a 3x cut in decode time/memory churn.
const FASTVLM_MAX_NEW_TOKENS = 160;

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
    const targetDevice = computeDevice.type === "webgpu" ? "webgpu" : "cpu";
    // Pin execution providers explicitly. The Ettin encoder takes int64 inputs,
    // which crash the threaded WASM build ("operation does not support unaligned
    // accesses" — seen in MV3 offscreen). WebGPU handles int64 natively, so it is
    // the primary EP; single-thread WASM is the CPU fallback (no SAB/atomics path).
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
          device: "cpu",
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
    const device = computeDevice.type === "webgpu" ? "webgpu" : "cpu";
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
 * Resizes large image to max 448px to avoid WebGPU freeze/OOM.
 * The redaction JSON schema doesn't need fine detail — dropping from 672px
 * cuts vision-token count (and the decode-time memory that scales with it)
 * substantially with no measurable loss in adjudication quality.
 */
async function prepareFastVLMImage(imageBlob) {
  try {
    const bitmap = await createImageBitmap(imageBlob);
    const max = 448;
    const w = bitmap.width;
    const h = bitmap.height;
    if (!w || !h || (w <= max && h <= max)) {
      return await load_image(imageBlob);
    }
    const scale = Math.min(max / w, max / h);
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    const resizedBlob = await canvas.convertToBlob({ type: "image/png" });
    console.log(`[FASTVLM] Resized image from ${w}x${h} to ${targetW}x${targetH} for stability`);
    return await load_image(resizedBlob);
  } catch (err) {
    console.warn(`[FASTVLM] Image resize failed, using original:`, err.message);
    return await load_image(imageBlob);
  }
}

/**
 * Runs FastVLM multimodal adjudication on image and extracted evidence
 */
async function runFastVLMAdjudication({ imageBlob, evidence, computeDevice }) {
  const fastvlm = await loadFastVLM(computeDevice);
  const prompt = buildFastVLMRedactionPrompt(evidence);
  const startTime = performance.now();

  const image = await prepareFastVLMImage(imageBlob);
  const messages = [{ role: "user", content: `<image>${prompt}` }];
  const renderedPrompt = fastvlm.processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });

  const inputs = await fastvlm.processor(image, renderedPrompt, {
    add_special_tokens: false,
  });

  const generated = await fastvlm.model.generate({
    ...inputs,
    max_new_tokens: FASTVLM_MAX_NEW_TOKENS,
    do_sample: false,
    repetition_penalty: 1.15,
    no_repeat_ngram_size: 3,
  });

  const inputLength = Number(inputs?.input_ids?.dims?.at(-1) ?? 0);
  let outputText = "";

  try {
    const generatedOnly = inputLength > 0 ? generated.slice(null, [inputLength, null]) : generated;
    outputText = fastvlm.processor.batch_decode(generatedOnly, { skip_special_tokens: true })[0] ?? "";
  } catch {
    outputText = fastvlm.processor.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
  }

  outputText = String(outputText).trim();
  if (!outputText) throw new Error("FastVLM generated an empty response");

  let parsed = null;
  let parseError = null;
  try {
    const jsonStr = extractJsonObject(outputText);
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    parseError = err;
    console.warn(`[FASTVLM] JSON parse failed: ${err.message}`);
  }

  const latencyMs = Math.round(performance.now() - startTime);

  // If FastVLM output was descriptive prose without JSON schema:
  // Salvage the outputText as the visual caption so the user ALWAYS gets a description!
  if (!parsed || !parsed.caption) {
    const cleanCaption = outputText.replace(/```(?:json)?[\s\S]*?```/gi, "").trim();
    if (cleanCaption) {
      if (!parsed) parsed = {};
      parsed.caption = cleanCaption;
    }
  }

  // Deterministic scrub: the 0.5B model echoes OCR values into the caption
  // despite prompt rule 10. Never let raw model text reach evidence/UI.
  if (parsed?.caption) {
    parsed.caption = sanitizeCaption(parsed.caption, evidence);
  }

  if (parseError && (!parsed.redactions || parsed.redactions.length === 0)) {
    // Return with error status so adjudicateOrFallback uses fusion_fallback,
    // but keep parsed.caption so caption is displayed to the user!
    return {
      status: "error",
      reason: parseError.message,
      raw: outputText,
      parsed,
      prompt,
      renderedPrompt,
      latencyMs,
    };
  }

  return {
    status: "ok",
    raw: outputText,
    parsed,
    prompt,
    renderedPrompt,
    inputTokens: inputLength,
    outputTokens: outputText.split(/\s+/).filter(Boolean).length,
    genMs: latencyMs,
    latencyMs,
  };
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

async function _runExtensionPipelineInner(inputImage, options = {}, onProgress = null) {
  const tTotalStart = performance.now();
  const emit = (stage, status, extra = {}) => {
    try {
      onProgress?.({ stage, status, ...extra });
    } catch {}
  };

  emit("INIT", "START");

  // 1. Device Resolution (Dedicated GPU -> Integrated GPU -> CPU Fallback)
  const computeDevice = await resolveComputeDevice(options.forceDeviceTier || null);
  configureOrtEnvironment(Ort, env, computeDevice);
  emit("DEVICE", "RESOLVED", { device: computeDevice });

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

  /* ---------------- FASTVLM 0.5B ADJUDICATION ---------------- */
  const fastvlmEnabled = options.fastvlmEnabled !== false;
  let fastvlmResult = null;

  if (fastvlmEnabled && (fusedCandidates.length > 0 || (ocr.items && ocr.items.length > 0))) {
    emit("FASTVLM", "START");
    try {
      fastvlmResult = await runFastVLMAdjudication({
        imageBlob: decoded.blob,
        evidence: fastvlmEvidence,
        computeDevice,
      });
      emit("FASTVLM", "DONE", {
        status: fastvlmResult.status,
        caption: fastvlmResult.parsed?.caption,
        redactionsCount: fastvlmResult.parsed?.redactions?.length || 0,
      });
    } catch (err) {
      console.warn("[WARN] FastVLM adjudication failed:", err.message);
      fastvlmResult = {
        status: "load_failed",
        reason: err.message,
        raw: JSON.stringify({ status: "load_failed", reason: err.message }),
      };
      emit("FASTVLM", "ERROR", { error: err.message });
    }
  } else {
    fastvlmResult = {
      status: "skipped",
      reason: fastvlmEnabled ? "No candidates found" : "FastVLM disabled by user",
      raw: JSON.stringify({ status: "skipped" }),
    };
  }

  /* ---------------- SAFETY & ADJUDICATION FALLBACK ---------------- */
  const adjudication = adjudicateOrFallback({
    ettinFindings: nerFindings,
    deterministicFindings,
    fusedCandidates,
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

  const imageRedaction = await redactImageOnCanvas(decoded.imageBitmap, finalFindings, {
    style: options.redactionStyle || "blur",
    faceStyle: options.faceRedactionStyle || options.redactionStyle || "blur",
    padding: options.padding ?? 2,
    facePadding: options.facePadding ?? 3,
    textBlurSigma: options.textBlurSigma ?? 12,
    faceBlurSigma: options.faceBlurSigma ?? 14,
  });
  emit("REDACT", "DONE", {
    textRegions: imageRedaction.textRegionsRedacted,
    faceRegions: imageRedaction.faceRegionsRedacted,
  });

  const totalTimeMs = Math.round(performance.now() - tTotalStart);

  // Centralized display caption: parsed.caption is already sanitized at the
  // source, but the raw-prose fallback below is NOT — scrub it here so no
  // unsanitized model text ever reaches evidence or the UI.
  const _rawFallback =
    fastvlmResult?.raw && !String(fastvlmResult.raw).trim().startsWith("{")
      ? sanitizeCaption(String(fastvlmResult.raw).trim(), fastvlmEvidence)
      : null;
  const safeCaption = sanitizeCaption(fastvlmResult?.parsed?.caption || _rawFallback || "", fastvlmEvidence) || null;

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
      source: "fastvlm",
      model: FASTVLM_MODEL,
      status: fastvlmResult?.status ?? "unknown",
    },
    florence: {
      description: safeCaption ?? "",
      caption: safeCaption ?? "",
      source: "fastvlm",
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
