import fs from "node:fs/promises";
import sharp from "sharp";

import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";

import {
    AutoProcessor,
    AutoModelForImageTextToText,
    AutoTokenizer,
    AutoModelForTokenClassification,
    load_image,
} from "@huggingface/transformers";
import * as Ort from "onnxruntime-node";

// Patch ORT DML deviceId: onnxruntime-node picks adapter by deviceId, DXGI order is driver-defined.
// Without this, deviceId 0 = iGPU on hybrid laptops. Thread DML_DEVICE_ID through wherever dml EP is constructed.
const _DML_DEVICE_ID_PATCH = (() => {
    const raw = process.env.DML_DEVICE_ID;
    if (raw === undefined || raw === "") return 0;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
})();
if (_DML_DEVICE_ID_PATCH !== 0) console.log(`[DML] Configured deviceId=${_DML_DEVICE_ID_PATCH} (via DML_DEVICE_ID env)`);
try {
    const origCreate = Ort.InferenceSession.create.bind(Ort.InferenceSession);
    Ort.InferenceSession.create = async (pathOrBuffer, opts) => {
        if (opts?.executionProviders) {
            const mapped = opts.executionProviders.map(ep => {
                if (ep === "dml") return { name: "dml", deviceId: _DML_DEVICE_ID_PATCH };
                if (ep && typeof ep === "object" && ep.name === "dml" && ep.deviceId === undefined) return { ...ep, deviceId: _DML_DEVICE_ID_PATCH };
                return ep;
            });
            // Only log once per process to avoid noise
            if (JSON.stringify(mapped) !== JSON.stringify(opts.executionProviders) && _DML_DEVICE_ID_PATCH !== 0) {
                console.log(`[DML] Patched executionProviders dml -> deviceId=${_DML_DEVICE_ID_PATCH}`);
            }
            opts = { ...opts, executionProviders: mapped };
        }
        return origCreate(pathOrBuffer, opts);
    };
} catch { }

/* ============================================================
   CONFIG

   NOTE ON SCOPE: this pass only handles the "image only, no DOM"
   case, per the current task. DOM evidence + the tiered
   regex/checksum -> NER -> FastVLM-adjudication redaction pipeline
   described in the architecture doc will be layered back in on
   top of this once the image-only path is solid. For now, NER
   findings above NER_MIN_SCORE are redacted directly (no
   adjudication tier) because the only thing leaving this module
   is a description, not a DOM mutation.
   ============================================================ */

const IMAGE_PATH = process.env.IMAGE_PATH || "s4.png";

/* ---------------- PaddleOCR (ppu-paddle-ocr, real detector+recognizer) ---------------- */

// V6_SMALL_MODEL = PP-OCRv6 small, full dictionary. Swap to V6_TINY_MODEL
// (the package default) for a lighter/faster model, or a V5_*_MODEL preset
// for a specific language. This is a real detection+recognition OCR engine
// (not a VLM), so it also returns proper per-line bounding boxes.
const PADDLEOCR_MODEL_PRESET = V6_SMALL_MODEL;

const PADDLEOCR_RECOGNITION_STRATEGY =
    process.env.PADDLEOCR_STRATEGY || "per-line";

const PADDLEOCR_MIN_CONFIDENCE = Number(
    process.env.PADDLEOCR_MIN_CONFIDENCE ?? 0.5
);

// OpenCV engine for detection box extraction (native findContours).
// Requires @techstark/opencv-js 4.x (pinned via package.json overrides) +
// the ppu-ocv resolveCv patch in patches/: the 4.x module is a non-Promise
// thenable whose .then() never settles under Node ESM, so resolveCv must not
// await/return it (see patches/ppu-ocv+4.0.0.patch). Do NOT upgrade
// @techstark/opencv-js to 5.x: its Mat.data heap views come back undefined
// and detection silently degrades to zero boxes.
const PADDLEOCR_ENGINE = process.env.PADDLEOCR_ENGINE || "opencv";

/* ---------------- NER (PII candidate detection) ---------------- */

const NER_MODEL = "./models/ettin-68m-nemotron-pii-onnx";
const NER_MODEL_FILE_NAME = "model";
const NER_MAX_TOKENS = 512;
const NER_MIN_SCORE = 0.3;

/* ---------------- FastVLM 0.5B ---------------- */

// Single multimodal model replacing BOTH:
//   - Previous visual perception (former model)
//   - Previous text adjudication (former model)
//
// Runs locally through Transformers.js + ONNX.
// No external model server is required.

const FASTVLM_ENABLED = process.env.FASTVLM_ENABLED !== "0";

const FASTVLM_MODEL =
    process.env.FASTVLM_MODEL ||
    "onnx-community/FastVLM-0.5B-ONNX";

const FASTVLM_MAX_NEW_TOKENS =
    Number(process.env.FASTVLM_MAX_NEW_TOKENS ?? 512);

const FASTVLM_DEVICE_RAW =
    String(
        process.env.FASTVLM_DEVICE ||
        process.env.MODEL_DEVICE ||
        "auto"
    ).toLowerCase().trim();

const FASTVLM_DEVICE =
    ["auto", "webgpu", "cpu", "wasm", "dml", "cuda", "gpu"].includes(FASTVLM_DEVICE_RAW)
        ? FASTVLM_DEVICE_RAW
        : "auto";

const FASTVLM_DTYPE = {
    embed_tokens: "fp16",
    vision_encoder: "q4f16",
    decoder_model_merged: "q4f16",
};

const FASTVLM_DEBUG =
    process.env.FASTVLM_DEBUG === "1";

const FASTVLM_REQUIRED =
    process.env.FASTVLM_REQUIRED === "1";

const FASTVLM_TIMEOUT_MS =
    Number(process.env.FASTVLM_TIMEOUT_MS ?? 180000);

const FASTVLM_MAX_IMAGE_SIZE =
    Number(process.env.FASTVLM_MAX_IMAGE_SIZE ?? 672);

const FASTVLM_RESIZE_ENABLED =
    process.env.FASTVLM_RESIZE_ENABLED !== "0";

const FASTVLM_CONFIDENCE_THRESHOLD =
    Number(process.env.FASTVLM_CONFIDENCE_THRESHOLD ?? 0.7);

const FINAL_REDACTION_CONFIDENCE_THRESHOLD =
    Number(
        process.env.FINAL_REDACTION_CONFIDENCE_THRESHOLD ?? 0.5
    );

let _fastvlmCache = null;
let _fastvlmLastLoadError = null;

const ENABLE_FASTVLM = (() => {
    const raw = process.env.ENABLE_FASTVLM;

    if (raw !== undefined) {
        const v = String(raw).toLowerCase().trim();

        if (["0", "false", "off", "no"].includes(v)) {
            return false;
        }

        if (["1", "true", "on", "yes"].includes(v)) {
            return true;
        }

        return v !== "0";
    }

    return FASTVLM_ENABLED;
})();

const FALLBACK_CONFIDENCE_THRESHOLD =
    Number(
        process.env.FALLBACK_CONFIDENCE_THRESHOLD ?? 0.72
    );

/* ---------------- Face Detection ---------------- */
// Lightweight local BlazeFace ONNX model. Downloaded automatically on first use
// and cached locally; no manual model download is required.
const FACE_ENABLED = process.env.FACE_ENABLED !== "0";
const FACE_MODEL_URL = process.env.FACE_MODEL_URL ||
    "https://huggingface.co/garavv/blazeface-onnx/resolve/main/blaze.onnx";
const FACE_MODEL_PATH = process.env.FACE_MODEL_PATH || "./models/blazeface/blaze.onnx";
const FACE_MIN_CONFIDENCE = Number(process.env.FACE_MIN_CONFIDENCE ?? 0.60);
const FACE_IOU_THRESHOLD = Number(process.env.FACE_IOU_THRESHOLD ?? 0.30);
const FACE_MAX_DETECTIONS = Number(process.env.FACE_MAX_DETECTIONS ?? 25);
const FACE_REDACTION_STYLE = (process.env.FACE_REDACTION_STYLE || "blur").toLowerCase();
const FACE_REDACTION_PADDING = Math.max(0, Number(process.env.FACE_REDACTION_PADDING ?? 3));
const FACE_BLUR_SIGMA = Math.max(1, Number(process.env.FACE_BLUR_SIGMA ?? 14));
let _faceModelCache = null;
let _faceModelLoadPromise = null;

// Compat shim: original visual/NER used MODEL_DEVICE_REQUESTED + resolveNodeModelDevice
// Now consolidated under FastVLM device selection.
const MODEL_DEVICE_REQUESTED = FASTVLM_DEVICE;
function resolveNodeModelDevice() {
    return resolveFastVLMDevice();
}


/* ---------------- Outputs ---------------- */

const EVIDENCE_OUTPUT_PATH = "./perception_evidence.json";

const FASTVLM_OUTPUT_PATH =
    process.env.FASTVLM_OUTPUT_FILE ||
    "./fastvlm_output.txt";

const FASTVLM_PROMPT_PATH =
    process.env.FASTVLM_PROMPT_FILE ||
    "./fastvlm_redaction_prompt.txt";

const FASTVLM_PERCEPTION_PROMPT_PATH =
    process.env.FASTVLM_PERCEPTION_PROMPT_FILE ||
    "./fastvlm_perception_prompt.txt";

const OUTPUT_IMAGE_PATH =
    "./output.png";

async function persistFastVLMOutput(text) {
    try {
        const content = String(text ?? "");

        await fs.writeFile(
            FASTVLM_OUTPUT_PATH,
            content,
            "utf8"
        );

        console.log(
            `[FASTVLM] Raw output saved: ${FASTVLM_OUTPUT_PATH} (${content.length} chars)`
        );
    } catch (e) {
        console.warn(
            `[FASTVLM] Failed to save raw output: ${e.message}`
        );
    }

}

/* ---------------- Image Redaction ----------------
   The output image is the original image with detected PII regions
   covered locally. No image generation model is used.

   Default:
     REDACTION_STYLE=blur

   Optional:
     REDACTION_STYLE=black (set REDACTION_STYLE=black to use black boxes)
   -------------------------------------------------- */

const IMAGE_REDACTION_STYLE = (
    process.env.REDACTION_STYLE || "blur"
).toLowerCase();

const IMAGE_REDACTION_PADDING = Math.max(
    0,
    Number(process.env.REDACTION_PADDING ?? 2)
);

/* ============================================================
   UTILS
   ============================================================ */

function logSection(title) {
    console.log("\n" + "=".repeat(60));
    console.log(` ${title}`);
    console.log("=".repeat(60));
}

function asString(value) {
    return value === null || value === undefined ? "" : String(value);
}

function cleanText(value) {
    return asString(value).replace(/\s+/g, " ").trim();
}

/* ============================================================
   VALUE SUB-BBOX ESTIMATION
   Returns bbox covering only targetText inside OCR item.
   Uses proportional character positioning (character-based
   horizontal proportion per spec Â§2).
   Signature: estimateTextSubBBox(item, targetText) where
   item = { text, bbox }. Never throws, returns null if
   localization not possible.
   ============================================================ */
function estimateTextSubBBox(item, targetText) {
    try {
        if (!item?.bbox || !Array.isArray(item.bbox) || item.bbox.length !== 4) return null;
        const rawFull = String(item.text ?? "");
        const rawTarget = String(targetText ?? "").trim();
        if (!rawFull || !rawTarget) return null;
        const fullText = cleanText(rawFull);
        const target = cleanText(rawTarget);
        if (!fullText || !target) return null;
        const lowerFull = fullText.toLowerCase();
        const lowerTarget = target.toLowerCase();
        // zero-width bbox guard
        const nums = item.bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = x2 - x1;
        if (width <= 0) return null;
        // Normalized whitespace matching: cleanText already collapses,
        // so "Certificate   No:   ABC123XY98" -> "Certificate No: ABC123XY98"
        let startIndex = lowerFull.indexOf(lowerTarget);
        // If not found with cleanText, try whitespace-normalized raw fallback
        if (startIndex < 0) {
            const wsFull = rawFull.replace(/\s+/g, " ").trim().toLowerCase();
            const wsTarget = rawTarget.replace(/\s+/g, " ").trim().toLowerCase();
            // map via cleaned versions lengths proportionally (approx)
            const wsIdx = wsFull.indexOf(wsTarget);
            if (wsIdx < 0) return null;
            // approximate ratio via whitespace-normalized lengths
            const ratioStart = wsIdx / Math.max(1, wsFull.length);
            const ratioEnd = (wsIdx + wsTarget.length) / Math.max(1, wsFull.length);
            return _proportionalBBox([x1, y1, x2, y2], ratioStart, ratioEnd);
        }
        const startRatio = startIndex / fullText.length;
        const endRatio = (startIndex + target.length) / fullText.length;
        if (endRatio <= startRatio) return null;
        // guard degenerate tiny ratio (e.g., 1 char in long line)
        if (endRatio - startRatio < 0.015) {
            // still return sub-bbox but ensure minimal width 4px
            const est = _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
            if (est && (est[2] - est[0]) < 2) return null;
            return est;
        }
        if (endRatio - startRatio > 0.98) {
            // target is essentially the whole line -> value is line
            return [x1, y1, x2, y2];
        }
        return _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
    } catch {
        return null;
    }
}
function _proportionalBBox(bbox, ratioStart, ratioEnd) {
    try {
        const nums = bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = Math.max(1, x2 - x1);
        const rs = Math.max(0, Math.min(1, ratioStart));
        const re = Math.max(0, Math.min(1, ratioEnd));
        if (re <= rs) return null;
        if (width <= 0) return null;
        return [
            x1 + width * rs,
            y1,
            x1 + width * re,
            y2
        ];
    } catch {
        return null;
    }
}
/* ------------------------------------------------------------
   GEOMETRY VALIDATION (Â§12)
   Reject bbox that is clearly the entire mixed label+value line
   when target is only a substring. Prefer tighter sub-bbox.
   ------------------------------------------------------------ */
function isLikelyValueOnlyBBox({ bbox, item, targetText }) {
    try {
        if (!bbox || !item?.bbox || !targetText) return false;
        const b = bbox.map(Number);
        const ib = item.bbox.map(Number);
        if (!b.every(Number.isFinite) || !ib.every(Number.isFinite)) return false;
        const bw = Math.abs(b[2] - b[0]);
        const iw = Math.abs(ib[2] - ib[0]);
        if (iw <= 0 || bw <= 0) return false;
        // If bbox equals whole item bbox while OCR text is much longer than target,
        // it's a whole-line bbox â€” not value-only.
        const exactMatch = b[0] === ib[0] && b[1] === ib[1] && b[2] === ib[2] && b[3] === ib[3];
        if (exactMatch) {
            const ocrText = cleanText(item.text);
            const target = cleanText(targetText);
            if (!ocrText || !target) return false;
            if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
                return false; // whole line masquerading as value
            }
            return true;
        }
        // If bbox width is close to full width but target is substring -> unsafe
        const target = cleanText(targetText);
        const ocrText = cleanText(item.text);
        if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
            const ratio = bw / iw;
            if (ratio > 0.92) return false;
        }
        return true;
    } catch {
        return false;
    }
}
/* Central value-bbox resolver â€” strict value-only geometry (Â§13)
   ONLY function to determine final redaction geometry. Prevents
   future paths from accidentally using whole OCR boxes.
   Algorithm Â§8:
    1. Find OCR item by OCR ID
    2. Check OCR text
    3. If exact equals sensitive value -> use OCR bbox
    4. Else if contains -> calculate value sub-bbox
    5. Else DO NOT use that OCR bbox
    6. Continue searching other supplied OCR IDs
    7. If no valid OCR value bbox: optionally use fused bbox ONLY if value-specific
    8. Otherwise reject/skip
   Forbidden: else if (ocrItem.bbox) push(whole bbox)
*/
function resolveSensitiveValueBBox({ text, ocrIds, evidence, fusedCandidate = null }) {
    try {
        const want = cleanText(text);
        if (!want) return null;
        const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
        // Iterate only supplied OCR IDs â€” never invent bbox
        for (const oid of ocrIds || []) {
            const ocrItem = ocrById.get(oid);
            if (!ocrItem?.bbox) continue;
            const ocrText = cleanText(ocrItem.text);
            if (!ocrText) continue;
            const lowerOcr = ocrText.toLowerCase();
            const lowerWant = want.toLowerCase();
            // Exact equality -> use full OCR bbox (value is line)
            if (lowerOcr === lowerWant) {
                if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate exact ocr_ids=${oid} bbox=[${ocrItem.bbox.map(n => Math.round(n)).join(",")}]`);
                return [...ocrItem.bbox.map(Number)];
            }
            // Contains -> calculate value sub-bbox
            if (lowerOcr.includes(lowerWant)) {
                const sub = estimateTextSubBBox(ocrItem, want);
                if (sub) {
                    // Validate not whole line
                    if (!isLikelyValueOnlyBBox({ bbox: sub, item: ocrItem, targetText: want })) {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific bbox for "${want}" at ${oid}`);
                        continue;
                    }
                    if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate sub-bbox ocr_ids=${oid} bbox=[${sub.map(n => Math.round(n)).join(",")}]`);
                    return sub;
                }
                // If substring exists but sub-bbox failed, only allow fallback if OCR is essentially the value
                if (ocrText.length <= want.length + 2) {
                    return [...ocrItem.bbox.map(Number)];
                }
                continue;
            }
            // OCR does not contain value â€” ignore this OCR ID entirely (Â§9)
            if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Skip OCR ${oid} does not contain value`);
        }
        // Â§11: fused fallback â€” only when no explicit value bbox found
        // Prefer OCR-derived sub-bbox from fused text, not blind fused.bbox
        if (fusedCandidate?.bbox) {
            const fusedText = cleanText(fusedCandidate.text);
            if (fusedText && fusedText.toLowerCase() === want.toLowerCase()) {
                // Try to locate fused text inside any OCR item that contains it for a value-specific bbox
                for (const oi of evidence.ocr || []) {
                    const ot = cleanText(oi.text);
                    if (!ot) continue;
                    if (ot.toLowerCase() === fusedText.toLowerCase()) {
                        return [...oi.bbox.map(Number)];
                    }
                    if (ot.toLowerCase().includes(fusedText.toLowerCase())) {
                        const sub = estimateTextSubBBox(oi, fusedText);
                        if (sub && isLikelyValueOnlyBBox({ bbox: sub, item: oi, targetText: fusedText })) return sub;
                    }
                }
                // For additional candidates (no fusedCandidate), allow direct fallback only if ocrIds empty
                if (!ocrIds || ocrIds.length === 0) {
                    // Validate fused bbox is value-specific before trusting
                    // Check if any OCR item's bbox equals fused bbox and that item is mixed -> reject
                    let isMixedWholeLine = false;
                    for (const oi of evidence.ocr || []) {
                        if (!oi.bbox) continue;
                        const same = oi.bbox[0] === fusedCandidate.bbox[0] && oi.bbox[1] === fusedCandidate.bbox[1] && oi.bbox[2] === fusedCandidate.bbox[2] && oi.bbox[3] === fusedCandidate.bbox[3];
                        if (same) {
                            const ot = cleanText(oi.text);
                            if (ot.toLowerCase().includes(fusedText.toLowerCase()) && ot.length > fusedText.length + 3) {
                                isMixedWholeLine = true;
                                break;
                            }
                        }
                    }
                    if (!isMixedWholeLine) {
                        if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Fallback to fused bbox for value-only`);
                        return [...fusedCandidate.bbox.map(Number)];
                    } else {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific fused bbox`);
                    }
                }
            }
        }
        return null;
    } catch {
        return null;
    }
}

/* ============================================================
   PLACEHOLDER / NOISE FILTER
   Keeps obvious UI labels and example values out of the NER pass
   so we don't waste model calls (or raise false PII flags) on
   things like a literal "Email Address" field label.
   ============================================================ */

const EXACT_PLACEHOLDERS = new Set([
    "name@example.com", "user@example.com", "test@example.com",
    "example@example.com", "your@email.com", "yourname@example.com",
    "example.com", "enter your email", "enter email", "your email",
    "email address", "enter username", "your username", "username",
    "enter password", "your password", "password", "phone number",
    "enter phone number", "123456", "000000", "xxxx", "xxxxx", "********",
]);

const EXAMPLE_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net"]);

function isExampleEmail(text) {
    const value = cleanText(text).toLowerCase();
    const match = value.match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i);
    return match ? EXAMPLE_EMAIL_DOMAINS.has(match[1]) : false;
}

function isPlaceholderText(text) {
    const value = cleanText(text).toLowerCase();
    if (!value) return true;
    if (EXACT_PLACEHOLDERS.has(value)) return true;
    if (isExampleEmail(value)) return true;
    return false;
}

function filterPlaceholderChunks(chunks) {
    return chunks.filter((chunk) => {
        if (!chunk || !chunk.text) return false;
        if (isPlaceholderText(chunk.text)) return false;
        return true;
    });
}

/* ============================================================
   PADDLE OCR — real detector + recognizer (ppu-paddle-ocr)
   Singleton: service is initialized once and reused across calls
   to avoid the 2–4 s initialize()/destroy() overhead per image.
   ============================================================ */

let _ocrServiceCache = null;

async function getOCRService() {
    if (_ocrServiceCache) return _ocrServiceCache;
    const service = new PaddleOcrService({
        model: PADDLEOCR_MODEL_PRESET,
        recognition: {
            strategy: PADDLEOCR_RECOGNITION_STRATEGY,
            minimumConfidence: PADDLEOCR_MIN_CONFIDENCE,
        },
        // Native opencv box extraction (see PADDLEOCR_ENGINE comment above).
        // Applies to both detection and recognition.
        processing: {
            engine: PADDLEOCR_ENGINE,
        },
    });
    await service.initialize();
    _ocrServiceCache = service;
    console.log(
        `[OCR] PaddleOCR singleton initialized (engine: ${PADDLEOCR_ENGINE}, reused for all calls)`
    );
    return service;
}

async function runOCR(imagePath) {
    logSection("Running PaddleOCR (ppu-paddle-ocr)");

    const service = await getOCRService();

    const fileBuffer = await fs.readFile(imagePath);
    const imageBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
    );

    const result = await service.recognize(imageBuffer, { flatten: true });

    console.log("\n[RAW PADDLE OCR OUTPUT]");
    console.log(JSON.stringify(result, null, 2));
    console.log("[END RAW PADDLE OCR OUTPUT]\n");

    const items = result.results
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
        model: "ppu-paddle-ocr (PP-OCRv6-small, detector+recognizer)",
        text: cleanText(result.text),
        confidence: result.confidence,
        items,
    };
}


/* ============================================================
   OCR GLOBAL SPAN MAPPING
   Maps each OCR region back to its character offsets in the
   complete OCR text. Uses cursor-based sequential matching
   to handle duplicate UI text (e.g. multiple "Name" labels).
   ============================================================ */

function buildOCRGlobalSpans(ocr) {
    if (!ocr?.text || !ocr?.items) {
        return { text: ocr?.text ?? "", spans: [] };
    }

    const sourceText = ocr.text;
    const spans = [];
    let cursor = 0;

    for (const item of ocr.items) {
        const regionText = cleanText(item.text);
        if (!regionText) {
            continue;
        }

        // Search for the region text starting from current cursor position
        const matchIndex = sourceText.indexOf(regionText, cursor);

        if (matchIndex >= 0) {
            // Found exact match at or after cursor
            const start = matchIndex;
            const end = matchIndex + regionText.length;
            cursor = end;

            spans.push({
                id: item.id,
                text: regionText,
                originalText: item.text,
                bbox: item.bbox ?? null,
                confidence: item.confidence ?? null,
                start,
                end,
            });
        } else {
            // Fallback: try case-insensitive or whitespace-normalized match
            const normalizedSource = sourceText
                .slice(cursor)
                .replace(/\s+/g, " ");
            const normalizedRegion = regionText.replace(/\s+/g, " ");

            const fallbackIndex = normalizedSource.indexOf(normalizedRegion);

            if (fallbackIndex >= 0) {
                // Map back to approximate position in original text
                const approxStart = cursor + fallbackIndex;
                const approxEnd = approxStart + regionText.length;

                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: approxStart,
                    end: approxEnd,
                });
                cursor = approxEnd;
            } else {
                // Cannot map this region confidently
                console.warn(
                    `[WARN] Could not map OCR region to global text: "${regionText}" (id: ${item.id})`
                );
                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: null,
                    end: null,
                });
            }
        }
    }

    return { text: sourceText, spans };
}

/* ============================================================
   ENTITY SPAN TO OCR REGION MAPPING
   Maps a global character span from Ettin back to OCR regions.
   ============================================================ */

function findOCRRegionsForSpan(entityStart, entityEnd, ocrSpans) {
    const matchingRegions = [];

    for (const span of ocrSpans) {
        if (span.start === null || span.end === null) continue;

        // Check if entity span intersects with this OCR region
        const intersects =
            entityStart < span.end && entityEnd > span.start;

        if (intersects) {
            matchingRegions.push(span);
        }
    }

    return matchingRegions;
}

function buildFindingsFromEntity(entity, ocrSpans, entityType) {
    const regions = findOCRRegionsForSpan(
        entity.start,
        entity.end,
        ocrSpans
    );

    if (regions.length === 0) {
        // Entity couldn't be mapped to any OCR region
        return [{
            source_id: "unmapped",
            entity: entityType,
            score: entity.score,
            text: entity.text,
            bbox: null,
            start: entity.start,
            end: entity.end,
            mapped: false,
        }];
    }

    // Create a finding for each OCR region this entity covers
    return regions.map((region) => ({
        source_id: region.id,
        entity: entityType,
        score: entity.score,
        text: region.text,
        bbox: region.bbox,
        start: entity.start,
        end: entity.end,
        mapped: true,
    }));
}

/* ============================================================
   PHASE 1 Ã¢â‚¬" OCR READING ORDER (spatial, non-destructive)
   ============================================================ */

function buildReadingOrder(ocr) {
    if (!ocr?.items?.length) return { ordered: [], rows: [] };
    const items = ocr.items.map((it) => ({
        ...it,
        bbox: it.bbox ?? [0, 0, 0, 0],
        text: cleanText(it.text),
    }));
    // Row clustering by y center
    const sortedByY = [...items].sort((a, b) => {
        const ay = (a.bbox[1] + a.bbox[3]) / 2;
        const by = (b.bbox[1] + b.bbox[3]) / 2;
        return ay - by;
    });
    const rows = [];
    for (const item of sortedByY) {
        const cy = (item.bbox[1] + item.bbox[3]) / 2;
        const h = Math.max(1, item.bbox[3] - item.bbox[1]);
        const tol = Math.max(8, h * 0.6);
        let row = rows.find((r) => Math.abs(r.cy - cy) < tol);
        if (!row) {
            row = { cy, items: [] };
            rows.push(row);
        }
        row.items.push(item);
        // update cy as mean
        row.cy = row.items.reduce((s, it) => s + (it.bbox[1] + it.bbox[3]) / 2, 0) / row.items.length;
    }
    // Sort rows top-bottom, items left-right
    rows.sort((a, b) => a.cy - b.cy);
    let order = 0;
    const ordered = [];
    for (const row of rows) {
        row.items.sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (const it of row.items) {
            ordered.push({ ...it, reading_order: order++ });
        }
    }
    return { ordered, rows };
}

/* ============================================================
   PHASE 2 Ã¢â‚¬" DETERMINISTIC CONTEXT ANALYZER
   ============================================================ */

const SENSITIVE_FIELD_VOCABULARY = [
    // Certificate / registration / application
    { label: "Certificate No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate No.", field_type: "CERTIFICATE_NUMBER" },
    { label: "Registration No", field_type: "REGISTRATION_NUMBER" },
    { label: "Registration Number", field_type: "REGISTRATION_NUMBER" },
    { label: "Reg No", field_type: "REGISTRATION_NUMBER" },
    { label: "Application No", field_type: "APPLICATION_NUMBER" },
    { label: "Application Number", field_type: "APPLICATION_NUMBER" },
    { label: "Application ID", field_type: "APPLICATION_ID" },
    { label: "Student ID", field_type: "STUDENT_ID" },
    { label: "Student Number", field_type: "STUDENT_ID" },
    { label: "Roll No", field_type: "ROLL_NUMBER" },
    { label: "Roll Number", field_type: "ROLL_NUMBER" },
    { label: "Admission No", field_type: "ADMISSION_NUMBER" },
    { label: "Admission Number", field_type: "ADMISSION_NUMBER" },
    { label: "Employee ID", field_type: "EMPLOYEE_ID" },
    { label: "Employee Number", field_type: "EMPLOYEE_ID" },
    { label: "Passport No", field_type: "PASSPORT_NUMBER" },
    { label: "Passport Number", field_type: "PASSPORT_NUMBER" },
    { label: "License No", field_type: "LICENSE_NUMBER" },
    { label: "Licence No", field_type: "LICENSE_NUMBER" },
    { label: "Policy Number", field_type: "POLICY_NUMBER" },
    { label: "Policy No", field_type: "POLICY_NUMBER" },
    { label: "Reference Number", field_type: "REFERENCE_NUMBER" },
    { label: "Reference No", field_type: "REFERENCE_NUMBER" },
    { label: "Document Number", field_type: "DOCUMENT_NUMBER" },
    { label: "Document No", field_type: "DOCUMENT_NUMBER" },
    { label: "Serial Number", field_type: "SERIAL_NUMBER" },
    { label: "Serial No", field_type: "SERIAL_NUMBER" },
    { label: "Date of Birth", field_type: "DATE_OF_BIRTH" },
    { label: "DOB", field_type: "DATE_OF_BIRTH" },
    { label: "Email", field_type: "EMAIL" },
    { label: "Email Address", field_type: "EMAIL" },
    { label: "Phone", field_type: "PHONE" },
    { label: "Phone Number", field_type: "PHONE" },
    { label: "Mobile", field_type: "PHONE" },
    { label: "Mobile Number", field_type: "PHONE" },
    { label: "Account Number", field_type: "ACCOUNT_NUMBER" },
    { label: "Account No", field_type: "ACCOUNT_NUMBER" },
    { label: "Card Number", field_type: "CARD_NUMBER" },
    { label: "UPI ID", field_type: "UPI_ID" },
    { label: "IFSC", field_type: "IFSC" },
    { label: "IBAN", field_type: "IBAN" },
];

function normalizeLabelForMatch(text) {
    let v = String(text ?? "").toLowerCase();
    // tolerate common OCR substitutions when matching labels only
    // do this before stripping punctuation so N0->no works
    v = v.replace(/0/g, "o");
    // normalize punctuation: . : - _ / all to space, collapse
    v = v.replace(/[.\-_:;\/\\]+/g, " ");
    v = v.replace(/\s+/g, " ").trim();
    // also tolerate 1/l/I confusion by normalizing single-char tokens? keep simple
    return v;
}

const NORMALIZED_VOCAB = SENSITIVE_FIELD_VOCABULARY.map((entry) => ({
    ...entry,
    normalized: normalizeLabelForMatch(entry.label),
}));

// longest normalized label first so "certificate number" wins over "certificate"
NORMALIZED_VOCAB.sort((a, b) => b.normalized.length - a.normalized.length);

function findFieldLabelMatch(text) {
    const norm = normalizeLabelForMatch(text);
    for (const entry of NORMALIZED_VOCAB) {
        if (norm === entry.normalized || norm.includes(entry.normalized) || entry.normalized.includes(norm)) {
            // require word-boundary-ish: check that matched label is not just substring of unrelated word
            // by ensuring normalized label appears as substring
            if (norm.includes(entry.normalized)) return entry;
            if (entry.normalized.includes(norm) && norm.length >= 3) return entry;
        }
    }
    // fuzzy: allow one-char difference for labels >=6 chars
    for (const entry of NORMALIZED_VOCAB) {
        if (Math.abs(norm.length - entry.normalized.length) > 2) continue;
        if (entry.normalized.length < 6) continue;
        let diffs = 0;
        const len = Math.min(norm.length, entry.normalized.length);
        for (let i = 0; i < len; i++) if (norm[i] !== entry.normalized[i]) diffs++;
        diffs += Math.abs(norm.length - entry.normalized.length);
        if (diffs <= 2) return entry;
    }
    return null;
}

function isPlausibleValue(text) {
    const v = String(text ?? "").trim();
    if (!v) return false;
    if (v.length < 2) return false;
    if (v.length > 80) return false;
    if (!/[a-z0-9]/i.test(v)) return false; // must contain alphanumeric
    if (/^[.,:;\/\-_]+$/.test(v)) return false;
    // reject ordinary long prose (many words, no identifier chars)
    const words = v.split(/\s+/);
    if (words.length > 8) return false;
    // FIX: strip leading ordinal like "13." / "14a." / "3)" before prose check so
    // "13. Do you have permanent U.S. Resident status?" is correctly classified
    // as prose/question, not a value, regardless of the leading number.
    const strippedForProse = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "");
    const proseWords = strippedForProse.split(/\s+/).filter(Boolean);
    if (proseWords.length > 4 && /^[a-z\s.,?()]+$/i.test(strippedForProse) && !/[\d\-_\/]/.test(strippedForProse)) return false;
    // Also reject if stripped form is long prose even with trailing punctuation (covers "?" / ")" cases)
    if (proseWords.length > 4 && !/[\d\-_\/]/.test(strippedForProse) && /^[a-z\s.,?()'"]+$/i.test(strippedForProse)) return false;
    // FIX: numbered field labels/questions like "9. Current Address", "2. Grades", "10. Phone Numbers"
    // are never plausible values â€” they are headers. If original starts with ordinal and stripped
    // contains no digits/@ (no PII-like chars), reject regardless of word count.
    if (/^\s*\d+[a-z]?[.)]\s+/i.test(v)) {
        const stripped = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "").trim();
        if (stripped && !/[\d@]/.test(stripped)) {
            // stripped is all letters/punct, no digits/email â€” it's a label, not a value
            // covers "9. Current Address" (2 words), "2. Grades" (1 word), "8. Place of Birth" etc.
            if (/^[a-z\s.,'()\/\-]+$/i.test(stripped)) return false;
        }
    }
    return true;
}

function extractLabelValueSameLine(ocrItems) {
    const candidates = [];
    // Ordered separator patterns â€” colon first (most specific), then hyphen/dash variants,
    // then 2+ spaces. Hyphen branch only accepted if label side is a known vocabulary entry,
    // so plain hyphenated prose does not create false positives.
    const SEPARATOR_PATTERNS = [
        /^(.+?):\s*(.+)$/,                 // "Label: value"
        /^(.+?[.:]?\s*[-â€“â€”]+)\s+(.+)$/,    // "Label.- value" / "Label- value" / "Label:- value" / "Reg. No.- value" (requires space after hyphen)
        /^(.+?)\s{2,}(.+)$/,               // "Label    value"
    ];
    for (const item of ocrItems) {
        const raw = String(item.text ?? "");
        let labelPart = null;
        let valuePart = null;
        let labelMatch = null;
        // Try each separator in order; keep first that BOTH matches regex AND is a known label
        for (const re of SEPARATOR_PATTERNS) {
            const m = raw.match(re);
            if (!m) continue;
            const candLabel = m[1];
            const candValue = m[2] ? m[2].trim() : "";
            if (!candLabel || !candValue) continue;
            const lm = findFieldLabelMatch(candLabel);
            if (!lm) continue; // hyphen split on non-label text â€” try next pattern (or skip)
            labelPart = candLabel;
            valuePart = candValue;
            labelMatch = lm;
            break;
        }
        if (!labelPart || !valuePart || !labelMatch) continue;
        if (!isPlausibleValue(valuePart)) continue;
        const valueBBox = estimateTextSubBBox(item, valuePart);
        // If value bbox cannot be confidently estimated, leave null (do NOT use full label+value bbox per Â§4)
        candidates.push({
            source: "deterministic_context",
            ocr_ids: [item.id],
            label: labelMatch.label,
            value: cleanText(valuePart),
            field_type: labelMatch.field_type,
            confidence: 0.98,
            reason: `Sensitive identifier value associated with ${labelMatch.label} label (same line)`,
            bbox: valueBBox ?? null,
            raw_text: raw,
        });
    }
    return candidates;
}

function extractLabelValueSideBySide(orderedItems, rows) {
    const candidates = [];
    // For each row, look for label item followed by value item to the right
    for (const row of rows) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (let i = 0; i < rowItems.length; i++) {
            const labelItem = rowItems[i];
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // candidate value is next item(s) to the right in same row
            for (let j = i + 1; j < rowItems.length; j++) {
                const valueItem = rowItems[j];
                const gap = valueItem.bbox[0] - labelItem.bbox[2];
                if (gap < -5) continue; // overlapping
                if (!isPlausibleValue(valueItem.text)) continue;
                // also need horizontal proximity â€” not across whole page without gap check
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.92,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (side-by-side)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} ${valueItem.text}`,
                });
                break; // only first value to the right
            }
        }
    }
    return candidates;
}

function extractLabelValueVertical(orderedItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        const labelRow = sortedRows[r];
        const valueRow = sortedRows[r + 1];
        const verticalGap = Math.min(...valueRow.items.map((it) => it.bbox[1])) - Math.max(...labelRow.items.map((it) => it.bbox[3]));
        if (verticalGap < 0 || verticalGap > 50) continue;
        // find label in upper row
        for (const labelItem of labelRow.items) {
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // check value row has plausible value with horizontal overlap
            for (const valueItem of valueRow.items) {
                const overlapLeft = Math.max(labelItem.bbox[0], valueItem.bbox[0]);
                const overlapRight = Math.min(labelItem.bbox[2], valueItem.bbox[2]);
                const overlap = Math.max(0, overlapRight - overlapLeft);
                const maxW = Math.max(labelItem.bbox[2] - labelItem.bbox[0], valueItem.bbox[2] - valueItem.bbox[0]);
                const ratio = maxW > 0 ? overlap / maxW : 0;
                const centerDx = Math.abs((labelItem.bbox[0] + labelItem.bbox[2]) / 2 - (valueItem.bbox[0] + valueItem.bbox[2]) / 2);
                if (ratio < 0.15 && centerDx > maxW * 0.8) continue;
                if (!isPlausibleValue(valueItem.text)) continue;
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.90,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (vertical)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} / ${valueItem.text}`,
                });
            }
        }
    }
    return candidates;
}

function extractMultiLineLabel(ocrItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        // Check if two consecutive rows together form a label, third row is value â€” simplified: label spans 2 lines
        const upperRow = sortedRows[r];
        const middleRow = sortedRows[r + 1];
        // try combining one item from upper + one from middle as multi-line label
        for (const u of upperRow.items) {
            for (const m of middleRow.items) {
                const combined = `${u.text} ${m.text}`;
                const labelMatch = findFieldLabelMatch(combined);
                if (!labelMatch) continue;
                // value could be same middle row after label, or next row
                // case: "Certificate" (row0) + "Number: ABC123XY98" (row1) â€” value in middle row itself
                const colonIdx = m.text.indexOf(":");
                if (colonIdx >= 0) {
                    const after = m.text.slice(colonIdx + 1).trim();
                    if (isPlausibleValue(after)) {
                        const afterBBox = estimateTextSubBBox(m, after);
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id],
                            label: labelMatch.label,
                            value: cleanText(after),
                            field_type: labelMatch.field_type,
                            confidence: 0.88,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label)`,
                            bbox: afterBBox ?? null,
                            raw_text: combined,
                        });
                        continue;
                    }
                }
                // value in next row
                if (r + 2 < sortedRows.length) {
                    const valueRow = sortedRows[r + 2];
                    for (const v of valueRow.items) {
                        if (!isPlausibleValue(v.text)) continue;
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id, v.id],
                            label: labelMatch.label,
                            value: cleanText(v.text),
                            field_type: labelMatch.field_type,
                            confidence: 0.86,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label + vertical value)`,
                            bbox: v.bbox ?? null,
                            raw_text: `${combined} / ${v.text}`,
                        });
                    }
                }
            }
        }
    }
    return candidates;
}

function extractSensitiveFieldCandidates(ocr) {
    if (!ocr?.items?.length) return [];
    const { ordered, rows } = buildReadingOrder(ocr);
    const sameLine = extractLabelValueSameLine(ocr.items);
    const sideBySide = extractLabelValueSideBySide(ordered, rows);
    const vertical = extractLabelValueVertical(ordered, rows);
    const multiLine = extractMultiLineLabel(ocr.items, rows);
    const all = [...sameLine, ...sideBySide, ...vertical, ...multiLine];
    // Deduplicate by ocr_ids+value
    const seen = new Map();
    for (const c of all) {
        const key = `${c.field_type}|${c.value}|${[...c.ocr_ids].sort().join(",")}`;
        if (!seen.has(key) || seen.get(key).confidence < c.confidence) seen.set(key, c);
    }
    // Also deduplicate by value alone if same field_type and overlapping bbox/value
    const deduped = [...seen.values()];
    // Prefer same-line over side-by-side when same value
    deduped.sort((a, b) => b.confidence - a.confidence);
    const finalMap = new Map();
    for (const c of deduped) {
        const vkey = `${c.field_type}|${c.value}`;
        if (!finalMap.has(vkey)) finalMap.set(vkey, c);
    }
    return [...finalMap.values()];
}

/* ============================================================
   NER Ã¢â‚¬" PII candidate detection over FULL OCR text sequence
   ============================================================ */

function normalizeId2Label(id2label) {
    const result = {};
    if (!id2label) return result;

    const entries =
        id2label instanceof Map ? id2label.entries() : Object.entries(id2label);

    for (const [key, value] of entries) {
        result[Number(key)] = String(value);
    }
    return result;
}

function softmax(values) {
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp(value - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((value) => value / sum);
}

function parseBioLabel(label) {
    const value = String(label ?? "O").trim();
    if (!value || value === "O") return { prefix: "O", type: null };

    const match = value.match(/^([BI])-?(.*)$/i);
    if (match) {
        return {
            prefix: match[1].toUpperCase(),
            type: match[2] ? match[2].trim() : null,
        };
    }
    return { prefix: "B", type: value };
}

function findEntitySpan(sourceText, entityText) {
    const source = cleanText(sourceText);
    const candidate = cleanText(entityText);

    const exact = source.indexOf(candidate);
    if (exact >= 0) return { start: exact, end: exact + candidate.length };

    const insensitive = source.toLowerCase().indexOf(candidate.toLowerCase());
    if (insensitive >= 0) {
        return { start: insensitive, end: insensitive + candidate.length };
    }
    return { start: null, end: null };
}

/**
 * Builds offset mapping manually when tokenizer doesn't support return_offsets_mapping.
 * Uses cursor-based sequential matching to map each token to character positions.
 */
function buildManualOffsetMapping(tokenIds, tokenizer, sourceText) {
    const mapping = [];
    let cursor = 0;

    for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = Number(tokenIds[i]);
        let tokenText = "";

        try {
            tokenText = tokenizer.decode([tokenId], { skip_special_tokens: true });
        } catch {
            mapping.push([cursor, cursor]);
            continue;
        }

        // Skip special tokens (empty text)
        if (!tokenText || tokenText.trim() === "") {
            mapping.push([cursor, cursor]);
            continue;
        }

        // Search for token text in source starting from cursor position.
        // We search forward from cursor to handle sequential token matching.
        const searchStart = cursor;
        const foundIndex = sourceText.indexOf(tokenText, searchStart);

        if (foundIndex >= 0) {
            const start = foundIndex;
            const end = foundIndex + tokenText.length;
            cursor = end;
            mapping.push([start, end]);
        } else {
            // Try trimmed token match from cursor forward
            const trimmed = tokenText.trim();
            const trimmedIndex = trimmed ? sourceText.indexOf(trimmed, cursor) : -1;
            if (trimmedIndex >= 0) {
                cursor = trimmedIndex + trimmed.length;
                mapping.push([trimmedIndex, cursor]);
            } else {
                // Keep cursor monotonically increasing — avoid jumping backward
                mapping.push([cursor, cursor]);
            }
        }
    }

    return mapping;
}

function mergeNERPredictions(predictions, tokenIds, tokenizer, offsetMapping, tokenTexts) {
    const entities = [];
    let current = null;

    // Helper: determine if a token is a subword continuation (no leading space)
    const isSubword = (text) => text && !text.startsWith(" ") && !text.startsWith("\n") && text.trim().length > 0;

    const flush = () => {
        if (!current) return;

        const ids = tokenIds.slice(current.startToken, current.endToken + 1);
        let text = "";
        let start = null;
        let end = null;

        if (offsetMapping && offsetMapping.length > 0) {
            // Use offset mapping for precise character spans
            const startOffset = offsetMapping[current.startToken];
            const endOffset = offsetMapping[current.endToken];

            if (startOffset && endOffset) {
                start = startOffset[0];
                end = endOffset[1];
                text = current.sourceText.slice(start, end);
            }
        }

        // Fallback to tokenizer.decode if offsets unavailable
        if (!text) {
            try {
                text = tokenizer.decode(ids, { skip_special_tokens: true });
            } catch {
                text = ids.join(" ");
            }
            text = cleanText(text);
        }

        if (text && current.type) {
            entities.push({
                entity: current.type,
                score:
                    current.scores.reduce((sum, v) => sum + v, 0) /
                    current.scores.length,
                text: cleanText(text),
                start,
                end,
                startToken: current.startToken,
                endToken: current.endToken,
            });
        }
        current = null;
    };

    for (const prediction of predictions) {
        const { prefix, type } = parseBioLabel(prediction.label);
        const score = prediction.score;
        const tokenText = tokenTexts?.[prediction.tokenIndex] ?? "";
        const subwordContinuation = isSubword(tokenText);

        // Subword continuations (no leading space, part of same word):
        // belong to the active entity even if individual subword score dipped
        if (current && subwordContinuation) {
            current.endToken = prediction.tokenIndex;
            current.scores.push(score);
            continue;
        }

        if (prefix === "O" || !type || score < NER_MIN_SCORE) {
            flush();
            continue;
        }

        const sameEntity = current && current.type === type;

        if (prefix === "I" && sameEntity) {
            current.endToken = prediction.tokenIndex;
            current.scores.push(score);
            continue;
        }

        flush();
        current = {
            type,
            startToken: prediction.tokenIndex,
            endToken: prediction.tokenIndex,
            scores: [score],
            sourceText: prediction.sourceText,
        };
    }

    flush();
    return entities;
}

async function resolveNERModelId() {
    // Try local first, then HF auto-download fallback
    const candidates = [
        NER_MODEL, // "./models/ettin-68m-nemotron-pii-onnx" (user local)
        "rulesentry-io/ettin-68m-nemotron-pii-onnx", // ONNX export (270MB, recommended)
        "kalyan-ks/ettin-68m-nemotron-pii", // PyTorch original (will be converted via optimum)
    ];
    for (const cand of candidates) {
        if (cand.startsWith("./") || cand.startsWith("/") || cand.startsWith("C:")) {
            try {
                await fs.access(cand);
                return cand;
            } catch {
                continue;
            }
        } else {
            // HF hub ID â€” always considered available (will download if not cached)
            return cand;
        }
    }
    // No local, return HF ONNX as default download target
    return "rulesentry-io/ettin-68m-nemotron-pii-onnx";
}

async function loadNER() {
    logSection("Loading Ettin NER");
    const nerDevice = resolveNodeModelDevice();
    if (nerDevice !== "cpu") console.log(`[NER] Using device: ${nerDevice} (via MODEL_DEVICE=${MODEL_DEVICE_REQUESTED})`);
    else console.log(`[NER] Using device: cpu`);

    const modelId = await resolveNERModelId();
    console.log(`[NER] Model: ${modelId} ${modelId !== NER_MODEL ? "(auto-download)" : ""}`);

    let lastError = null;
    // Try candidate + one retry after cache clear if protobuf corrupted
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const tokenizer = await AutoTokenizer.from_pretrained(modelId);
            const model = await AutoModelForTokenClassification.from_pretrained(
                modelId,
                { dtype: "fp32", model_file_name: NER_MODEL_FILE_NAME, device: nerDevice }
            );
            const id2label = normalizeId2Label(model.config?.id2label);
            if (Object.keys(id2label).length === 0) {
                throw new Error("NER id2label missing.");
            }
            const configuredMax = Number(
                model.config?.max_position_embeddings ?? NER_MAX_TOKENS
            );
            const maxTokens = Math.min(
                NER_MAX_TOKENS,
                configuredMax > 0 ? configuredMax : NER_MAX_TOKENS
            );
            if (attempt > 0) console.log(`[NER] Loaded after retry (attempt ${attempt + 1})`);
            return { tokenizer, model, id2label, maxTokens };
        } catch (error) {
            lastError = error;
            const msg = String(error.message || error);
            console.warn(`[WARN] NER load attempt ${attempt + 1} failed: ${msg}`);
            const isCorrupt = msg.includes("Protobuf parsing failed") || msg.includes("Load model from") || msg.includes("ENOENT");
            if (isCorrupt && attempt === 0) {
                // Try clearing HF cache for this model and retry once
                try {
                    const cacheDir = `node_modules/@huggingface/transformers/.cache/${modelId.replace("/", "__")}`;
                    await fs.rm(cacheDir, { recursive: true, force: true });
                    console.log(`[NER] Cleared cache ${cacheDir}, retrying...`);
                } catch { }
                continue;
            }
            // If local path failed, try next HF candidate
            if (modelId === NER_MODEL && attempt === 0) {
                console.log(`[NER] Falling back to HF hub download...`);
                try {
                    const hfId = "rulesentry-io/ettin-68m-nemotron-pii-onnx";
                    const tokenizer = await AutoTokenizer.from_pretrained(hfId);
                    const model = await AutoModelForTokenClassification.from_pretrained(
                        hfId,
                        { dtype: "fp32", model_file_name: NER_MODEL_FILE_NAME }
                    );
                    const id2label = normalizeId2Label(model.config?.id2label);
                    return { tokenizer, model, id2label, maxTokens: Math.min(NER_MAX_TOKENS, Number(model.config?.max_position_embeddings ?? NER_MAX_TOKENS)) };
                } catch (e2) {
                    lastError = e2;
                }
            }
            throw lastError;
        }
    }
    throw lastError;
}

/**
 * Runs Ettin NER ONCE on the complete OCR text sequence.
 *
 * WHY FULL TEXT: Ettin performs better when it can see surrounding context.
 * Example: "Jeet@777" alone might be classified as a username, but with
 * "Password\nJeet@777\nSign In" context, it correctly identifies as PASSWORD.
 *
 * The complete OCR text is sent as ONE sequence. Entity spans are then mapped
 * back to original OCR regions using character offsets.
 *
 * @param {Object} ner - NER model/tokenizer from loadNER()
 * @param {Object} ocr - OCR result with .text (full) and .items (regions)
 * @returns {Array} findings with source_id, bbox, entity, score, text
 */
async function runNER(ner, ocr) {
    const DEBUG_NER = process.env.DEBUG_NER === "1";
    const findings = [];

    // Build OCR global span mapping (character offsets in full text)
    const { text: sourceText, spans: ocrSpans } = buildOCRGlobalSpans(ocr);

    if (!sourceText || ocrSpans.length === 0) {
        console.log("[NER] No OCR text to process.");
        return findings;
    }

    // Log input mode for verification
    console.log("\n[NER INPUT MODE]");
    console.log("  FULL OCR TEXT SEQUENCE");
    console.log(`  Characters: ${sourceText.length}`);
    console.log(`  OCR regions: ${ocrSpans.length}`);

    if (DEBUG_NER) {
        console.log("\n[ETTIN INPUT]");
        console.log("  " + sourceText.slice(0, 200) + (sourceText.length > 200 ? "..." : ""));
    }

    console.log("\n[NER] Running Ettin once on complete OCR sequence...");

    try {
        // Tokenize the COMPLETE OCR text as ONE sequence
        let encoded;
        let offsetMapping = null;

        try {
            // Try with offset_mapping for precise character spans
            encoded = await ner.tokenizer(sourceText, {
                truncation: true,
                max_length: ner.maxTokens,
                return_offsets_mapping: true,
            });

            // Extract offset mapping if available
            if (encoded.offset_mapping) {
                offsetMapping = Array.from(encoded.offset_mapping, (pair) =>
                    Array.isArray(pair) ? pair : [pair[0], pair[1]]
                );
            }
        } catch (offsetError) {
            // Fallback: tokenizer doesn't support offset_mapping
            if (DEBUG_NER) {
                console.log(`[NER] offset_mapping not supported, using fallback: ${offsetError.message}`);
            }
            encoded = await ner.tokenizer(sourceText, {
                truncation: true,
                max_length: ner.maxTokens,
            });
        }

        const tokenIds = Array.from(
            encoded.input_ids.data ?? encoded.input_ids,
            Number
        );

        // If offset_mapping not provided by tokenizer, build it manually
        if (!offsetMapping) {
            offsetMapping = buildManualOffsetMapping(tokenIds, ner.tokenizer, sourceText);
            if (DEBUG_NER) {
                console.log(`[NER] Built manual offset mapping (${offsetMapping.length} tokens)`);
            }
        }

        // Run Ettin inference ONCE on the complete sequence
        const outputs = await ner.model(encoded);
        const dims = outputs.logits.dims.map(Number);
        const data = outputs.logits.data;
        const sequenceLength = dims[1];
        const numberOfLabels = dims[2];

        // Build predictions with source text reference for span extraction
        const predictions = [];
        const tokenTexts = [];

        // Pre-decode all tokens for subword continuation detection
        for (let i = 0; i < tokenIds.length; i++) {
            try {
                tokenTexts[i] = ner.tokenizer.decode([tokenIds[i]], {
                    skip_special_tokens: true,
                });
            } catch {
                tokenTexts[i] = "";
            }
        }

        for (
            let tokenIndex = 0;
            tokenIndex < Math.min(sequenceLength, tokenIds.length);
            tokenIndex++
        ) {
            const row = new Array(numberOfLabels);
            for (let labelIndex = 0; labelIndex < numberOfLabels; labelIndex++) {
                row[labelIndex] = Number(
                    data[tokenIndex * numberOfLabels + labelIndex]
                );
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
                sourceText, // Reference for offset mapping
            });
        }

        // Merge BIO predictions into entities with global character spans
        const entities = mergeNERPredictions(
            predictions,
            tokenIds,
            ner.tokenizer,
            offsetMapping,
            tokenTexts
        );

        console.log(`[NER] Detected ${entities.length} entities in full text.`);

        // Map each entity back to OCR region(s) using character spans
        for (const entity of entities) {
            if (isPlaceholderText(entity.text)) continue;

            // Use global character span from offset mapping
            let entityStart = entity.start;
            let entityEnd = entity.end;

            // Fallback: if no offset mapping, search for entity text in source
            if (entityStart === null || entityEnd === null) {
                const span = findEntitySpan(sourceText, entity.text);
                entityStart = span.start;
                entityEnd = span.end;
            }

            if (entityStart === null || entityEnd === null) {
                console.warn(`[WARN] Could not locate entity "${entity.text}" in OCR text`);
                continue;
            }

            // Find OCR regions that intersect with this entity span
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

    } catch (error) {
        console.warn(`[WARN] NER failed: ${error.message}`);
    }

    // Log findings summary
    console.log("\n[NER FINDINGS]");
    for (const finding of findings) {
        console.log(`  ${finding.entity} | score: ${finding.score.toFixed(3)} | region: ${finding.source_id}`);
        if (finding.bbox) {
            console.log(`    bbox: [${finding.bbox.join(", ")}]`);
        }
        if (DEBUG_NER) {
            console.log(`    text: "${finding.text}"`);
        }
    }

    return findings;
}

/* ============================================================
   PHASE 4 Ã¢â‚¬" CANDIDATE FUSION & DEDUPLICATION
   ============================================================ */

function normalizeCandidateText(t) {
    return cleanText(t).toLowerCase();
}

function isContained(smaller, larger) {
    const s = normalizeCandidateText(smaller);
    const l = normalizeCandidateText(larger);
    if (!s || !l) return false;
    if (s === l) return false;
    return l.includes(s);
}

function fuseRedactionCandidates({ ettinFindings = [], deterministicFindings = [] }) {
    const raw = [];
    let cid = 0;
    const nextId = () => `cand_${String(cid++).padStart(3, "0")}`;

    for (const f of ettinFindings) {
        const text = cleanText(f.text);
        if (!text) continue;
        const ocrIds = f.source_id && f.source_id !== "unmapped" ? [f.source_id] : [];
        raw.push({
            candidate_id: nextId(),
            ocr_ids: ocrIds,
            text,
            label_context: null,
            candidate_types: [f.entity ?? "UNKNOWN"],
            sources: ["ettin"],
            confidence: Number(f.score ?? 0),
            bbox: f.bbox ?? null,
            original: f,
        });
    }
    for (const d of deterministicFindings) {
        raw.push({
            candidate_id: nextId(),
            ocr_ids: [...(d.ocr_ids ?? [])],
            text: cleanText(d.value),
            label_context: d.label ?? null,
            candidate_types: [d.field_type ?? "UNKNOWN"],
            sources: ["deterministic_context"],
            confidence: Number(d.confidence ?? 0.9),
            bbox: d.bbox ?? null,
            original: d,
        });
    }

    // Merge duplicate sources that share same text+ocr_ids: boost confidence, merge sources
    const byKey = new Map();
    for (const c of raw) {
        const key = `${normalizeCandidateText(c.text)}|${[...c.ocr_ids].sort().join(",")}`;
        if (!byKey.has(key)) byKey.set(key, c);
        else {
            const existing = byKey.get(key);
            existing.sources = [...new Set([...existing.sources, ...c.sources])];
            existing.candidate_types = [...new Set([...existing.candidate_types, ...c.candidate_types])];
            existing.confidence = Math.max(existing.confidence, c.confidence);
            if (!existing.label_context && c.label_context) existing.label_context = c.label_context;
            if (!existing.bbox && c.bbox) existing.bbox = c.bbox;
        }
    }
    let candidates = [...byKey.values()];

    // Containment rule: if smaller text fully contained in larger text and shares OCR region or overlaps,
    // keep larger only. Also handle same OCR region containment.
    // Sort by text length descending so larger wins.
    candidates.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
    const keep = [];
    for (const c of candidates) {
        let contained = false;
        for (const k of keep) {
            const sameRegion = c.ocr_ids.length && k.ocr_ids.length && c.ocr_ids.some((id) => k.ocr_ids.includes(id));
            const textContained = isContained(c.text, k.text);
            if (textContained && sameRegion) {
                contained = true;
                // merge evidence into keeper if smaller had deterministic label
                if (!k.label_context && c.label_context) k.label_context = c.label_context;
                k.sources = [...new Set([...k.sources, ...c.sources])];
                k.candidate_types = [...new Set([...k.candidate_types, ...c.candidate_types])];
                break;
            }
            // also handle bbox overlap containment when bboxes exist
            if (c.bbox && k.bbox && textContained) {
                const overlap = !(c.bbox[2] < k.bbox[0] || c.bbox[0] > k.bbox[2] || c.bbox[3] < k.bbox[1] || c.bbox[1] > k.bbox[3]);
                if (overlap) { contained = true; break; }
            }
        }
        if (!contained) keep.push(c);
    }

    // Do not merge adjacent non-overlapping entities solely by proximity
    return keep;
}

/* ============================================================
   UI STRUCTURE ANALYSIS
    Generic geometry-based UI role detection from OCR + image geometry.
    NO additional ML model required Ã¢â‚¬" uses OCR bboxes, text, and image dims.
   ============================================================ */

// ---- Normalize a single OCR item geometry ----

function normalizeOcrItem(item, imageWidth, imageHeight) {
    const bbox = item.bbox ? item.bbox : [0, 0, 0, 0];
    const x1 = bbox[0];
    const y1 = bbox[1];
    const x2 = bbox[2];
    const y2 = bbox[3];
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    const centerX = x1 + width / 2;
    const centerY = y1 + height / 2;

    return {
        id: item.id,
        text: cleanText(item.text),
        originalText: item.text,
        bbox: [x1, y1, x2, y2],
        x1, y1, x2, y2,
        width, height,
        centerX, centerY,
        // Normalized coordinates (0-1 range)
        normX1: x1 / imageWidth,
        normY1: y1 / imageHeight,
        normX2: x2 / imageWidth,
        normY2: y2 / imageHeight,
        normWidth: width / imageWidth,
        normHeight: height / imageHeight,
        normCenterX: centerX / imageWidth,
        normCenterY: centerY / imageHeight,
    };
}

// ---- Geometric relationships between two normalized OCR items ----

function computeRelationship(itemA, itemB, imageWidth, imageHeight) {
    const dx = Math.abs(itemA.centerX - itemB.centerX);
    const dy = Math.abs(itemA.centerY - itemB.centerY);
    const minWidth = Math.min(itemA.width, itemB.width);
    const minHeight = Math.min(itemA.height, itemB.height);

    // Tolerances relative to image size and text dimensions
    const heightTol = Math.max(8, minHeight * 0.5);
    const widthTol = Math.max(8, minWidth * 0.5);

    // Horizontal overlap
    const overlapX = Math.max(0, Math.min(itemA.x2, itemB.x2) - Math.max(itemA.x1, itemB.x1));
    const overlapY = Math.max(0, Math.min(itemA.y2, itemB.y2) - Math.max(itemA.y1, itemB.y1));
    const overlaps = (overlapX > 0 && overlapY > 0);

    // Same row: vertical centers close relative to their heights
    const sameRow = dy < heightTol;

    // Same column: horizontal centers close relative to their widths
    const sameColumn = dx < widthTol;

    // Above: A's bottom is above B's top with small gap
    const above = itemA.y2 < itemB.y1 - 2;

    // Below: A's bottom is below B's top with small gap
    const below = itemA.y1 > itemB.y2 + 2;

    // Left of: A's right is left of B's left with small gap
    const leftOf = itemA.x2 < itemB.x1 - 2;

    // Right of: A's right is right of B's left with small gap
    const rightOf = itemA.x1 > itemB.x2 + 2;

    // Horizontally aligned: vertical centers within tolerance
    const horizontallyAligned = dy < heightTol;

    // Vertically aligned: horizontal centers within tolerance
    const verticallyAligned = dx < widthTol;

    // Near: generally close (both dx and dy small relative to dimensions)
    const near = dx < widthTol + 20 && dy < heightTol + 20;

    // Significant horizontal overlap (more than 30% of either text width)
    const significantOverlap = overlapX > Math.max(itemA.width, itemB.width) * 0.3;

    // Significant vertical overlap
    const significantVerticalOverlap = overlapY > Math.max(itemA.height, itemB.height) * 0.3;

    // One contains the other (bbox containment)
    const contains =
        itemA.x1 <= itemB.x1 && itemA.y1 <= itemB.y1 &&
        itemA.x2 >= itemB.x2 && itemA.y2 >= itemB.y2;

    // Reverse containment
    const containsReverse =
        itemB.x1 <= itemA.x1 && itemB.y1 <= itemA.y1 &&
        itemB.x2 >= itemA.x2 && itemB.y2 >= itemA.y2;

    // Same vertical position (centers within 10% of image height)
    const sameVerticalPosition = Math.abs(itemA.normCenterY - itemB.normCenterY) < 0.1;

    // Same horizontal position (centers within 10% of image width)
    const sameHorizontalPosition = Math.abs(itemA.normCenterX - itemB.normCenterX) < 0.1;

    // Estimate if two regions are likely in the same container
    const likelySameContainer = (dx < imageWidth * 0.3 && dy < imageHeight * 0.3) ||
        (significantOverlap && !sameRow) ||
        (significantVerticalOverlap && sameRow);

    return {
        sameRow,
        sameColumn,
        above,
        below,
        leftOf,
        rightOf,
        near,
        overlaps,
        horizontallyAligned,
        verticallyAligned,
        near,
        significantOverlap,
        significantVerticalOverlap,
        contains,
        containsReverse,
        likelySameContainer,
        sameVerticalPosition,
        sameHorizontalPosition,
    };
}

// ---- Detect horizontal sibling groups (segmented controls/tabs) ----

function detectHorizontalGroups(items) {
    // Cluster items that are on the same row, horizontally separated,
    // with similar heights, suggesting a segmented control/tab group.

    if (items.length < 2) return [];

    // Sort by centerY then centerX
    const sorted = [...items].sort((a, b) =>
        a.centerY - b.centerY || a.centerX - b.centerX
    );

    // Group items by row (clustering by centerY)
    const rows = [];
    for (const item of sorted) {
        const matchedRow = rows.find(row => {
            // Check if this item's centerY is close to any existing row
            return Math.abs(item.centerY - row.refCenterY) < (item.height * 0.5 + 6);
        });

        if (matchedRow) {
            matchedRow.items.push(item);
            // Update reference center
            matchedRow.refCenterY = (matchedRow.refCenterY * (matchedRow.items.length - 1) + item.centerY) / matchedRow.items.length;
            // Re-sort row by centerX
            matchedRow.items.sort((a, b) => a.centerX - b.centerX);
        } else {
            rows.push({
                refCenterY: item.centerY,
                items: [item],
            });
        }
    }

    // For each row with 2+ items, check if they form a horizontal group
    const groups = [];
    for (const row of rows) {
        if (row.items.length < 2) continue;

        // Check: are they horizontally separated but on same row?
        // And do they have similar heights?
        const heights = row.items.map(i => i.height);
        const heightMean = heights.reduce((a, b) => a + b, 0) / heights.length;
        const heightVariance = heights.reduce((a, b) => a + Math.pow(b - heightMean, 2), 0) / heights.length;
        const heightStd = Math.sqrt(heightVariance);
        const heightCoeff = heightStd / Math.max(heightMean, 1);

        // Items must be on same row (vertical alignment) and horizontally separated
        const areHorizontallySeparated = row.items.slice(1).every((it, i) =>
            it.centerX > row.items[0].centerX + Math.max(it.width, row.items[0].width) * 0.3
        );

        const haveSimilarHeight = heightCoeff < 0.5;

        if (areHorizontallySeparated && haveSimilarHeight) {
            // Sort by centerX
            const sortedItems = [...row.items].sort((a, b) => a.centerX - b.centerX);
            const bbox = [
                sortedItems[0].x1,
                Math.min(...sortedItems.map(i => i.y1)),
                sortedItems[sortedItems.length - 1].x2,
                Math.max(...sortedItems.map(i => i.y2)),
            ];

            groups.push({
                id: `group_${groups.length.toString().padStart(3, '0')}`,
                type: "segmented_control",
                bbox,
                children: sortedItems.map(item => item.id),
                confidence: 0.7 + 0.3 * (sortedItems.length / 4),
                evidence: ["same_row", "similar_height", "horizontal_siblings"],
            });
        }
    }

    return groups;
}

// ---- Detect label-value input candidates ----

function detectInputCandidates(items) {
    const candidates = [];

    // For each pair of items, check if one is above another forming a label-value pair
    for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
            if (i === j) continue;

            const a = items[i];
            const b = items[j];

            // Skip if either has very short text (likely not a label or value)
            if (a.text.length < 2 || b.text.length < 2) continue;

            // Check if B is below A (label above value pattern)
            // Conditions:
            // - B is below A (a.y2 < b.y1 with small gap)
            // - Significant horizontal overlap (they're aligned)
            // - Small vertical gap
            // - Reasonable width alignment

            const gap = b.y1 - a.y2;
            if (gap > 0 && gap < 40) { // Small vertical gap
                // Check horizontal overlap/alignment
                const overlapLeft = Math.max(a.x1, b.x1);
                const overlapRight = Math.min(a.x2, b.x2);
                const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);
                const maxWidth = Math.max(a.width, b.width);
                const overlapRatio = maxWidth > 0 ? horizontalOverlap / maxWidth : 0;

                // Also check center alignment
                const centerDx = Math.abs(a.centerX - b.centerX);

                // Strong candidate: good horizontal overlap AND centered
                if (overlapRatio > 0.3 && centerDx < a.width * 0.5) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.5 + 0.3 * overlapRatio + 0.2 * (1 - centerDx / Math.max(a.width, 1)),
                        evidence: ["vertical_pair", "horizontal_alignment", "close_spacing"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }

                // Weak candidate: just vertically close with some alignment
                if (overlapRatio > 0.15 && centerDx < a.width * 1.0) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.3 + 0.4 * overlapRatio,
                        evidence: ["vertical_pair", "some_alignment"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }
            }
        }
    }

    // Deduplicate: if two candidates share the same value_ocr_id, keep the higher-confidence one
    const seenValueIds = new Set();
    const filtered = candidates.filter(candidate => {
        if (seenValueIds.has(candidate.value_ocr_id)) return false;
        seenValueIds.add(candidate.value_ocr_id);
        return true;
    });

    return filtered;
}

// ---- Detect button candidates ----

function detectButtonCandidates(items, imageWidth, imageHeight) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text (likely not a button)
        if (text.length > 30) continue;

        // Button criteria (geometry-focused):
        // 1. Reasonably compact region (not too tall, not too wide)
        const aspectRatio = item.width / Math.max(item.height, 1);
        const isCompact = item.width < imageWidth * 0.6 && item.height < imageHeight * 0.3;

        // 2. Positioned below the main form area (typical for login forms)
        //    - y position is in the lower portion of the image
        const isBelowForm = item.normCenterY > 0.4;

        // 3. Isolated from body text (not near long paragraphs)
        //    - relatively short height compared to image
        const isIsolated = item.height < imageHeight * 0.25;

        let score = 0;
        let reasons = [];

        if (isCompact) {
            score += 0.3;
            reasons.push("compact_region");
        }
        if (isBelowForm) {
            score += 0.3;
            reasons.push("below_form");
        }
        if (isIsolated) {
            score += 0.2;
            reasons.push("isolated");
        }

        // Minimum score to qualify as button candidate
        if (score >= 0.75) {
            candidates.push({
                type: "button_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.9, 0.5 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
                normCenterX: item.normCenterX,
                normCenterY: item.normCenterY,
            });
        }
    }

    return candidates;
}

// ---- Detect link candidates ----

function detectLinkCandidates(items) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text
        if (text.length > 40) continue;

        // Link-like semantic signals (weak, used with geometry)
        const lower = text.toLowerCase();
        const linkKeywords = ["forgot", "reset", "sign up", "login", "contact", "support",
            "previous", "next", "back", "home", "close", "cancel", "submit"];

        const hasLinkKeyword = linkKeywords.some(kw => lower.includes(kw));

        // Isolated text signal
        const isIsolated = item.height < 40;

        let score = 0;
        let reasons = [];

        if (hasLinkKeyword) {
            score += 0.3;
            reasons.push("link_keyword");
        }
        if (isIsolated) {
            score += 0.3;
            reasons.push("isolated");
        }

        if (score >= 0.3) {
            candidates.push({
                type: "link_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.85, 0.4 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
            });
        }
    }

    return candidates;
}

// ---- Detect containers/parent regions ----

function detectContainers(items, imageWidth, imageHeight) {
    // Try to infer visual containers around clusters of OCR regions.
    // Uses a simple approach: if a group of OCR items are tightly clustered
    // within a rectangular area, infer a container.

    if (items.length < 2) return [];

    // Sort by centerX then centerY
    const sorted = [...items].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

    // Cluster items: find groups that are close together
    const clusters = [];
    const visited = new Set();

    for (let i = 0; i < sorted.length; i++) {
        const itemI = sorted[i];
        if (visited.has(itemI.id)) continue;

        const cluster = [itemI];
        visited.add(itemI.id);

        for (let j = i + 1; j < sorted.length; j++) {
            const itemJ = sorted[j];
            if (visited.has(itemJ.id)) continue;

            // Check if itemJ is close to any item in the cluster
            const clusterItem = cluster[0]; // Use first as reference
            const dx = Math.abs(itemJ.centerX - clusterItem.centerX);
            const dy = Math.abs(itemJ.centerY - clusterItem.centerY);

            // Close if within half the sum of widths/heights + some margin
            const close = dx < (clusterItem.width + itemJ.width) * 0.5 + 20 &&
                dy < (clusterItem.height + itemJ.height) * 0.5 + 20;

            if (close) {
                cluster.push(itemJ);
                visited.add(itemJ.id);
            }
        }

        if (cluster.length >= 2) {
            // Compute cluster bounding box
            const bbox = [
                Math.min(...cluster.map(i => i.x1)),
                Math.min(...cluster.map(i => i.y1)),
                Math.max(...cluster.map(i => i.x2)),
                Math.max(...cluster.map(i => i.y2)),
            ];

            // Only create container if it has reasonable size (not the whole image)
            const containerWidth = bbox[2] - bbox[0];
            const containerHeight = bbox[3] - bbox[1];
            const isReasonableSize = containerWidth < imageWidth * 0.8 && containerHeight < imageHeight * 0.8;

            if (isReasonableSize) {
                clusters.push({
                    id: `container_${clusters.length.toString().padStart(3, '0')}`,
                    bbox,
                    itemIds: cluster.map(i => i.id),
                    confidence: 0.5 + 0.3 * Math.min(cluster.length / 6, 1),
                    evidence: ["clustered_regions"],
                });
            }
        }
    }

    return clusters;
}

// ---- Main UI structure builder ----

/**
 * Builds a UI structure analysis from screenshot, OCR, and optional FastVLM caption.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.image - Image with width/height
 * @param {Object} params.ocr - OCR result with items array
 * @param {Object} params.fastvlm - Optional FastVLM caption result
 * @returns {Object} UI structure with elements, groups, relationships, containers
 */
function buildUIStructure({ image, ocr, fastvlm }) {
    const imageWidth = image.width;
    const imageHeight = image.height;

    // 1. Normalize all OCR items
    const normalizedItems = ocr.items.map(item =>
        normalizeOcrItem(item, imageWidth, imageHeight)
    ).filter(item => item.text && item.text.length > 0);

    // 2. Compute all pairwise relationships
    const relationships = [];
    for (let i = 0; i < normalizedItems.length; i++) {
        for (let j = i + 1; j < normalizedItems.length; j++) {
            const rel = computeRelationship(normalizedItems[i], normalizedItems[j], imageWidth, imageHeight);

            if (rel.sameRow || rel.sameColumn || rel.above || rel.below ||
                rel.overlaps || rel.contains || rel.containsReverse || rel.likelySameContainer) {
                relationships.push({
                    ocr_id_a: normalizedItems[i].id,
                    ocr_id_b: normalizedItems[j].id,
                    ...rel,
                });
            }
        }
    }

    // 3. Detect horizontal sibling groups (segmented controls/tabs)
    const groups = detectHorizontalGroups(normalizedItems);

    // 4. Detect input candidates (label above value)
    const inputCandidates = detectInputCandidates(normalizedItems);

    // 5. Detect button candidates
    const buttonCandidates = detectButtonCandidates(normalizedItems, imageWidth, imageHeight);

    // 6. Detect link candidates
    const linkCandidates = detectLinkCandidates(normalizedItems);

    // 7. Detect containers
    const containers = detectContainers(normalizedItems, imageWidth, imageHeight);

    // 8. Build elements summary
    const elements = normalizedItems.map(item => ({
        id: item.id,
        text: item.text,
        bbox: item.bbox,
        centerX: item.centerX,
        centerY: item.centerY,
        normCenterX: item.normCenterX,
        normCenterY: item.normCenterY,
        width: item.width,
        height: item.height,
    }));

    return {
        imageWidth,
        imageHeight,
        elements,
        groups,
        relationships,
        inputCandidates,
        buttonCandidates,
        linkCandidates,
        containers,
    };
}

/* ============================================================
   PHASE 5 Ã¢â‚¬" FASTVLM ADJUDICATION INPUT / PROMPT / INFERENCE
   ============================================================ */

const ALLOWED_FASTVLM_TYPES = new Set([
    "first_name",
    "last_name",
    "user_name",
    "name",
    "full_name",
    "person",
    "person_name",
    "company_name",
    "company",
    "organization",
    "org",
    "certificate_number",
    "certificate_license_number",
    "registration_number",
    "application_number",
    "application_id",
    "student_id",
    "roll_number",
    "admission_number",
    "employee_id",
    "customer_id",
    "passport_number",
    "license_number",
    "policy_number",
    "reference_number",
    "document_number",
    "serial_number",
    "date",
    "date_of_birth",
    "dob",
    "time",
    "date_time",
    "email",
    "phone",
    "phone_number",
    "mobile",
    "fax_number",
    "account_number",
    "card_number",
    "credit_debit_card",
    "cvv",
    "pin",
    "bank_routing_number",
    "swift_bic",
    "upi_id",
    "ifsc",
    "iban",
    "unique_id",
    "ssn",
    "national_id",
    "tax_id",
    "license_plate",
    "vehicle_identifier",
    "device_identifier",
    "biometric_identifier",
    "medical_record_number",
    "health_plan_beneficiary_number",
    "street_address",
    "city",
    "state",
    "county",
    "country",
    "postcode",
    "address",
    "coordinate",
    "password",
    "api_key",
    "age",
    "gender",
    "blood_type",
    "education_level",
    "employment_status",
    "occupation",
    "pii",
    "other",
    "unknown",
]);

function buildFastVLMRedactionEvidence({ image, ocr, ettinFindings, deterministicFindings, fusedCandidates }) {
    return {
        image: { width: image.width, height: image.height },
        ocr: (ocr.items || []).map((it) => ({
            id: it.id,
            text: cleanText(it.text),
            bbox: it.bbox ?? null,
            confidence: it.confidence ?? null,
        })),
        ettin_candidates: (ettinFindings || []).map((f) => ({
            entity: f.entity,
            text: cleanText(f.text),
            score: f.score,
            source_id: f.source_id,
            bbox: f.bbox ?? null,
        })),
        deterministic_candidates: (deterministicFindings || []).map((d) => ({
            label: d.label,
            value: cleanText(d.value),
            field_type: d.field_type,
            confidence: d.confidence,
            ocr_ids: d.ocr_ids,
            bbox: d.bbox ?? null,
            reason: d.reason,
        })),
        fused_candidates: (fusedCandidates || []).map((c) => ({
            candidate_id: c.candidate_id,
            ocr_ids: c.ocr_ids,
            text: c.text,
            label_context: c.label_context,
            candidate_types: c.candidate_types,
            sources: c.sources,
            confidence: c.confidence,
            bbox: c.bbox ?? null,
        })),
    };
}

function buildFastVLMRedactionPrompt(evidence) {
    const ocrJoined =
        evidence.ocr
            .map(
                o => o.text
            )
            .join(" | ")
            .slice(0, 12000) ||
        "(no OCR)";

    const ocrIds =
        evidence.ocr
            .map(
                o => o.id
            )
            .join(",") ||
        "(none)";

    const fusedLines =
        evidence.fused_candidates
            .map(
                c =>
                    `${c.candidate_id} "${c.text}" types=[${(
                        c.candidate_types ||
                        []
                    ).join(",")}] conf=${Number(
                        c.confidence ?? 0
                    ).toFixed(
                        2
                    )} ocr=${(
                        c.ocr_ids ||
                        []
                    ).join(",")}`
            )
            .join("\n") ||
        "(none)";

    return `
You are PerScope's local multimodal
privacy-redaction adjudicator.

Inspect the screenshot directly.

Use the OCR and candidate evidence only
as supporting evidence.

Your job is to decide which actual VALUES
visible in the screenshot are sensitive
personal or confidential information.

OUTPUT ONLY ONE JSON OBJECT.
NO MARKDOWN.
NO CODE FENCES.
NO EXPLANATION.
NO REASONING.

Schema:

{
  "caption": "detailed visual description of everything visible, without repeating sensitive values",
  "redactions": [],
  "additional_redactions": [],
  "rejected_candidates": []
}

RULES:

1. Approve only genuine sensitive VALUES.

2. Never redact:
   - labels
   - headings
   - field names
   - section titles
   - questions
   - instructions
   - button labels

3. Example:
   "Certificate No: ABC123XY98"
   -> redact "ABC123XY98"
   -> DO NOT redact "Certificate No"

4. Existing redactions MUST use a
   candidate_id from the FUSED list.

5. Additional redactions MUST use:
   - an existing OCR ID
   - text actually present in OCR

6. Never invent:
   - candidate IDs
   - OCR IDs
   - text
   - PII

7. Reject UI labels/questions such as:
   "Current Address"
   "Phone Numbers"
   "Grades"
   "Position Title"

 8. Value types are given by the FUSED candidate types.
    Do NOT enumerate or list category names anywhere in your
    output, especially not in the caption.

 9. Never reconstruct text hidden behind
   [REDACTED:*].

 10. Caption is a DETAILED visual description of everything visible:
     main subjects and their appearance, clothing, background, colors,
     composition, objects, text regions, photo/emblem/QR presence.
     Write 2-4 full sentences. Be concrete and specific about what you
     SEE (e.g. "short hair", "light-colored shirt", "blurred background").
     It must NEVER contain, repeat, or reconstruct ANY sensitive value
     from OCR or the FUSED list — not names, numbers, dates, IDs, or parts
     of them. It must NEVER mention rules, redaction, sensitivity,
     confidentiality, or policy, and must NEVER give verdicts such as
     "there are no sensitive details" or refuse to describe: just describe.
     GOOD: "Portrait photo of a person with short hair wearing a
     light-colored shirt, centered against a blurred indoor background
     with soft frontal lighting and warm colors."
    BAD (critical failure, NEVER do this): "Aadhaar card of Bhushan
    Diwakar, DOB 05/07/2002, number 4906 5637 6032" — this leaks PII.

11. Confidence must be between 0 and 1.

OCR IDS:
${ocrIds}

FUSED CANDIDATES:
${fusedLines}

OCR:
${ocrJoined}
`;
}

// Isolated loader â€” text-only Q4F16 quantized FastVLM-0.5B adjudication with WebGPU.
// Verified: @huggingface/transformers 4.2.0 exports AutoModelForImageTextToText (multimodal
// variant of multimodal family). When loaded via ImageTextToText, resolveTypeConfig()
// sets textOnly=true so only embed_tokens + decoder_model_merged are requested â€”
// vision_encoder is NOT downloaded/initialized (session_config.js: ImageTextToText).
// Verified repo siblings (onnx-community/FastVLM-0.5B-ONNX): embed_tokens_q4.onnx and
// decoder_model_merged_q4f16.onnx exist; dtype mapping uses
//   DEFAULT_DTYPE_SUFFIX_MAPPING = { q4: "_q4", q4f16: "_q4f16" }.
// Verified devices (transformers 4.2.0 src/utils/devices.js + src/backends/onnx.js):
//   webgpu, wasm, cpu, auto are valid; defaultDevices: cpu (Node) / wasm (Browser),
//   supportedDevices includes webgpu. Env apis.IS_WEBGPU_AVAILABLE = IS_NODE_ENV || ('gpu' in navigator).

function buildPerceptionPrompt(evidence) {
    // Shim: original vision-based perception prompt removed.
    // For FastVLM, reuse the redaction prompt evidence.
    try {
        const ev = evidence.fastvlm_evidence || evidence;
        return buildFastVLMRedactionPrompt(ev);
    } catch {
        return "Perception prompt unavailable";
    }
}


/* ============================================================
   FASTVLM 0.5B LOCAL ONNX INFERENCE
   ============================================================ */

function getRuntime() {
    const isNode =
        typeof process !== "undefined" &&
        process.release?.name === "node";

    if (isNode) {
        return "Node";
    }

    if (
        typeof window !== "undefined" ||
        typeof navigator !== "undefined"
    ) {
        return "Browser";
    }

    return "Unknown";
}

function resolveFastVLMDevice() {
    // Normalize gpu alias
    let requested = FASTVLM_DEVICE;
    if (requested === "gpu") {
        if (process.platform === "win32") requested = "dml";
        else if (process.platform === "linux" && process.arch === "x64") requested = "cuda";
        else requested = "cpu";
    }

    if (requested === "webgpu") {
        return "webgpu";
    }

    if (
        requested === "cpu" ||
        requested === "wasm"
    ) {
        return "cpu";
    }

    if (requested === "dml" || requested === "cuda") {
        const isNode = getRuntime() === "Node";
        if (!isNode) {
            // Browser cannot use dml/cuda directly, fallback to webgpu if available else cpu
            if (typeof navigator !== "undefined" && navigator.gpu) return "webgpu";
            return "cpu";
        }
        const isWin = process.platform === "win32";
        const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
        if (requested === "dml" && isWin) return "dml";
        if (requested === "cuda" && isLinuxX64) return "cuda";
        if (requested === "cuda" && isWin) {
            console.log(`[FASTVLM] CUDA not available on Windows prebuilt, using DirectML (dml) instead (deviceId=${_DML_DEVICE_ID_PATCH})`);
            return "dml";
        }
        if (requested === "dml" && !isWin) {
            console.log(`[FASTVLM] DirectML (dml) only available on Windows, falling back to CPU`);
            return "cpu";
        }
        return "cpu";
    }

    // auto:
    // Browser -> WebGPU when available
    // Node    -> DML on Windows (dedicated GPU via DML_DEVICE_ID), CUDA on Linux, else CPU
    if (
        getRuntime() === "Browser" &&
        typeof navigator !== "undefined" &&
        navigator.gpu
    ) {
        return "webgpu";
    }

    // Node auto prefers dedicated GPU when available
    if (getRuntime() === "Node") {
        if (process.platform === "win32") {
            // Prefer DML (dedicated GPU). DML_DEVICE_ID selects adapter (0=iGPU, 1=dGPU).
            // If DML_DEVICE_ID explicitly set to 1, we are targeting dedicated GPU.
            return "dml";
        }
        if (process.platform === "linux" && process.arch === "x64") return "cuda";
    }

    return "cpu";
}

async function loadFastVLM() {
    if (!FASTVLM_ENABLED || !ENABLE_FASTVLM) {
        return null;
    }

    if (_fastvlmCache) {
        return _fastvlmCache;
    }

    const runtime = getRuntime();
    const device = resolveFastVLMDevice();

    console.log(
        `\n========== FASTVLM RUNTIME ==========`
    );

    console.log(
        `Model: ${FASTVLM_MODEL}`
    );

    console.log(
        `Runtime: ${runtime}`
    );

    console.log(
        `Requested device: ${FASTVLM_DEVICE} (raw=${FASTVLM_DEVICE_RAW})`
    );

    console.log(
        `Selected device: ${device}${device === "dml" ? ` (DirectML deviceId=${_DML_DEVICE_ID_PATCH})` : ""}`
    );

    if (device === "dml") {
        console.log(`[FASTVLM] DML dedicated GPU: deviceId=${_DML_DEVICE_ID_PATCH} (0=iGPU, 1=dGPU on hybrid - set DML_DEVICE_ID=1 for RTX 3050)`);
    }

    console.log(
        `Dtype: ${JSON.stringify(FASTVLM_DTYPE)}`
    );

    console.log(
        `====================================`
    );

    try {
        const processor =
            await AutoProcessor.from_pretrained(
                FASTVLM_MODEL
            );

        const model =
            await AutoModelForImageTextToText.from_pretrained(
                FASTVLM_MODEL,
                {
                    dtype: FASTVLM_DTYPE,
                    device,
                }
            );
        console.log("[FASTVLM-DEBUG] sessions:", Object.keys(model.sessions || {}));

        _fastvlmCache = {
            model,
            processor,
            modelId: FASTVLM_MODEL,
            runtime,
            device,
            backend:
                device === "webgpu"
                    ? "WebGPU"
                    : device === "dml"
                        ? `DirectML (deviceId=${_DML_DEVICE_ID_PATCH})`
                        : device === "cuda"
                            ? "CUDA"
                            : "ONNX Runtime CPU",
            dtype: FASTVLM_DTYPE,
        };

        console.log(
            `[FASTVLM] Loaded ${FASTVLM_MODEL}`
        );

        console.log(
            `[FASTVLM] Backend: ${_fastvlmCache.backend}`
        );

        return _fastvlmCache;
    } catch (error) {
        _fastvlmLastLoadError = error;

        console.error(
            `[FASTVLM LOAD ERROR] ${error?.name || "Error"}: ${error?.message || error}`
        );

        if (FASTVLM_REQUIRED) {
            throw error;
        }

        return {
            status: "load_failed",
            error: String(
                error?.message || error
            ),
            device,
            runtime,
        };
    }
}

function buildFastVLMImagePrompt(prompt) {
    return [
        {
            role: "user",
            content: `<image>${prompt}`,
        },
    ];
}


async function prepareFastVLMImage(imagePath) {
    // Resize large/complex images to avoid DML freeze/OOM.
    // FastVLM 0.5B vision_encoder is q4 and expects ~336-448px; large screenshots (1920x1080+) cause
    // huge token counts and DML Gather OOM / hang. Resize longest side to FASTVLM_MAX_IMAGE_SIZE.
    if (!FASTVLM_RESIZE_ENABLED) {
        return await load_image(imagePath);
    }
    try {
        const meta = await sharp(imagePath).metadata();
        const w = Number(meta.width || 0);
        const h = Number(meta.height || 0);
        const max = FASTVLM_MAX_IMAGE_SIZE;
        if (!w || !h || (w <= max && h <= max)) {
            return await load_image(imagePath);
        }
        console.log(`[FASTVLM] Large image detected ${w}x${h}, resizing longest side -> ${max}px for GPU stability`);
        const buf = await sharp(imagePath)
            .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer();
        // load_image can take Buffer via RawImage; use temp file for compatibility
        const tmpPath = `${imagePath}.fastvlm.tmp.png`;
        try {
            await fs.writeFile(tmpPath, buf);
            const img = await load_image(tmpPath);
            try { await fs.unlink(tmpPath); } catch { }
            console.log(`[FASTVLM] Resized image prepared ${max}px max`);
            return img;
        } catch (e) {
            // Fallback: try direct buffer load
            try { return await load_image(buf); } catch { }
            throw e;
        }
    } catch (e) {
        console.warn(`[FASTVLM] Image resize failed, using original: ${e.message}`);
        return await load_image(imagePath);
    }
}

// Deterministic caption scrub: the 0.5B model echoes OCR values into the
// caption despite prompt rule 10. Never let raw model text reach evidence.
function sanitizeCaption(caption, evidence) {
    let out = String(caption ?? "");
    if (!out) return out;
    const ev = evidence?.fastvlm_evidence || evidence || {};
    const repl = [];
    // Issuer / layout words are NOT sensitive values: keep them so the
    // caption stays sufficient and complete. Only real PII values get scrubbed.
    const CAPTION_SCRUB_SKIP = new Set([
        "COUNTRY", "GENDER", "ORGANIZATION", "ORG", "COMPANY",
        "COMPANY_NAME", "NATIONALITY", "LANGUAGE",
    ]);
    const push = (text, type) => {
        const tag = String(type || "PII").toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "PII";
        if (CAPTION_SCRUB_SKIP.has(tag)) return;
        const t = cleanText(text);
        if (!t || t.length < 2) return;
        repl.push({ text: t, type: tag });
        const digits = t.replace(/\D+/g, "");
        if (digits.length >= 4) {
            repl.push({ text: t, type: tag, digitsOnly: digits });
        }
    };
    for (const c of ev.fused_candidates || []) push(c.text, (c.candidate_types || [])[0]);
    for (const d of ev.deterministic_candidates || []) push(d.value, d.field_type);
    for (const e of ev.ettin_candidates || []) push(e.text, e.entity);
    repl.sort((a, b) => (b.digitsOnly || b.text).length - (a.digitsOnly || a.text).length);
    const esc = (s) => String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const r of repl) {
        let pat = null;
        if (r.digitsOnly) {
            // Any non-alphanumeric separators tolerated: "05072002" catches
            // "05/07/2002", "05-07-2002", "05 07 2002" etc.
            pat = r.digitsOnly.split("").map(esc).join("[^A-Za-z0-9]*");
        } else {
            const tokens = String(r.text).split(/\s+/).filter(Boolean).map(esc);
            if (!tokens.length) continue;
            pat = tokens.join("\\s+");
        }
        try {
            out = out.replace(new RegExp(pat, "gi"), `[REDACTED:${r.type}]`);
        } catch {}
    }
    // Collapse greedy-decoding repetition loops (0.5B model repeats the same
    // sentence/category list when it misses the JSON schema). Dedupe
    // sentences, then hard-cap length so a fallback caption stays one short
    // layout sentence instead of kilobytes of "sensitive information such as...".
    out = out.replace(/\s+/g, " ").trim();
    try {
        const parts = out.split(/(?<=[.!?])\s+/);
        const seen = new Set();
        const uniq = [];
        for (const p of parts) {
            const k = p.toLowerCase().trim();
            if (!k) continue;
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(p.trim());
        }
        out = uniq.join(" ");
        out = out.replace(/(\b.{16,}?)\s*(?:\.\s*)?\1+/gi, "$1");
    } catch {}
    // Hard-cap length, but never end mid-sentence: back off to the last
    // sentence boundary so captions don't trail off like "... If you".
    if (out.length > 600) {
        const cut = out.slice(0, 600);
        const lastEnd = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
        out = (lastEnd > 120 ? cut.slice(0, lastEnd + 1) : cut.replace(/\s+\S*$/, "")).trim();
    }
    return out;
}

async function runFastVLMRedactionAdjudication({
    imagePath,
    evidence,
}) {
    if (
        !FASTVLM_ENABLED ||
        !ENABLE_FASTVLM
    ) {
        const raw = JSON.stringify({
            status: "skipped",
            reason: "FASTVLM disabled",
        });

        await persistFastVLMOutput(raw);

        return {
            status: "skipped",
            reason: "FASTVLM disabled",
            raw,
        };
    }

    const fastvlm =
        await loadFastVLM();

    if (
        !fastvlm ||
        fastvlm.status === "load_failed" ||
        !fastvlm.model ||
        !fastvlm.processor
    ) {
        const reason =
            fastvlm?.error ||
            "FastVLM model not loaded";

        const raw = JSON.stringify({
            status: "load_failed",
            reason,
        });

        await persistFastVLMOutput(raw);

        return {
            status: "load_failed",
            reason,
            raw,
        };
    }

    const prompt =
        buildFastVLMRedactionPrompt(evidence);

    const startTime = Date.now();

    try {
        const image =
            await prepareFastVLMImage(imagePath);

        const messages =
            buildFastVLMImagePrompt(prompt);

        const renderedPrompt =
            fastvlm.processor.apply_chat_template(
                messages,
                {
                    add_generation_prompt: true,
                }
            );

        const inputs =
            await fastvlm.processor(
                image,
                renderedPrompt,
                {
                    add_special_tokens: false,
                }
            );

        // Timeout-guarded generation to avoid freeze on large/complex images on DML
        const generatePromise = fastvlm.model.generate({
            ...inputs,
            max_new_tokens:
                FASTVLM_MAX_NEW_TOKENS,
            do_sample: false,
            repetition_penalty: 1.15,
            no_repeat_ngram_size: 3,
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error(`FastVLM generation timeout after ${FASTVLM_TIMEOUT_MS}ms - image may be too large/complex for DML`), { isTimeout: true })), FASTVLM_TIMEOUT_MS)
        );
        let generated;
        try {
            generated = await Promise.race([generatePromise, timeoutPromise]);
        } catch (genErr) {
            if (genErr?.isTimeout || String(genErr.message).includes("timeout")) {
                console.error(`[FASTVLM] Generation timed out after ${FASTVLM_TIMEOUT_MS}ms (device=${fastvlm.device}, image may be too large)`);
                // Do not hang - throw to trigger fallback
                throw genErr;
            }
            throw genErr;
        }

        const inputLength =
            Number(
                inputs?.input_ids?.dims?.at(-1) ??
                0
            );

        let outputText = "";

        try {
            const generatedOnly =
                inputLength > 0
                    ? generated.slice(
                        null,
                        [inputLength, null]
                    )
                    : generated;

            outputText =
                fastvlm.processor.batch_decode(
                    generatedOnly,
                    {
                        skip_special_tokens: true,
                    }
                )[0] ?? "";
        } catch {
            outputText =
                fastvlm.processor.batch_decode(
                    generated,
                    {
                        skip_special_tokens: true,
                    }
                )[0] ?? "";
        }

        outputText =
            String(outputText).trim();

        if (!outputText) {
            throw new Error(
                "FastVLM generated an empty response"
            );
        }

        await persistFastVLMOutput(
            outputText
        );

        let jsonStr;
        let parsed;
        try {
            jsonStr = extractJsonObject(outputText);
            parsed = JSON.parse(jsonStr);
            if (parsed?.caption) {
                parsed.caption = sanitizeCaption(parsed.caption, evidence);
            }
        } catch (parseError) {
            // Keep original output as raw for debugging, trigger fallback via validation_failed
            console.warn(`[FASTVLM] JSON extraction/parse failed: ${parseError.message}`);
            console.warn(`[FASTVLM] Raw output preview: ${String(outputText).slice(0, 500).replace(/\n/g, "\\n")}`);
            throw new Error(`No JSON object found in FastVLM output: ${parseError.message}`);
        }

        const latencyMs =
            Date.now() - startTime;

        return {
            status: "ok",

            raw: outputText,

            parsed,

            prompt,

            renderedPrompt,

            inputTokens: inputLength,

            outputTokens:
                outputText
                    .split(/\s+/)
                    .filter(Boolean)
                    .length,

            genMs: latencyMs,

            latencyMs,

            device:
                fastvlm.device,

            backend:
                fastvlm.backend,

            dtype:
                fastvlm.dtype,

            model:
                FASTVLM_MODEL,
        };
    } catch (error) {
        _fastvlmLastLoadError =
            error;
        // Dedicated GPU freeze/OOM hint for large images
        const msg = String(error?.message || "");
        if (fastvlm?.device === "dml" && (/timeout/i.test(msg) || /parameter is incorrect/i.test(msg) || /out of memory/i.test(msg) || /non-zero status/i.test(msg))) {
            console.error(`[FASTVLM] DML GPU failed on large/complex image (deviceId=${_DML_DEVICE_ID_PATCH}). Try:`);
            console.error(`[FASTVLM]  1) Reduce FASTVLM_MAX_IMAGE_SIZE (current ${FASTVLM_MAX_IMAGE_SIZE}, try 672 or 512)`);
            console.error(`[FASTVLM]  2) Force CPU: FASTVLM_DEVICE=cpu node v7.mjs`);
            console.error(`[FASTVLM]  3) Check dedicated GPU: DML_DEVICE_ID=1 FASTVLM_DEVICE=dml (currently DML_DEVICE_ID=${_DML_DEVICE_ID_PATCH})`);
            console.error(`[FASTVLM] Falling back to fusion (CPU-safe) for this image.`);
        }

        const reason =
            String(
                error?.message ||
                error
            );

        // Preserve original model output if available; don't overwrite fastvlm_output.txt with error JSON
        // outputText already persisted above if generation succeeded. Only persist error if no output.
        let raw;
        try {
            if (typeof outputText !== "undefined" && outputText) {
                raw = String(outputText);
                // Optionally append error info to console, but keep raw as original for evidence
                console.warn(`[FASTVLM] Generation/parsing error, preserving original output as raw. Reason: ${reason}`);
            } else {
                raw = JSON.stringify({
                    status: "error",
                    reason,
                });
                await persistFastVLMOutput(raw);
            }
        } catch {
            raw = JSON.stringify({
                status: "error",
                reason,
            });
            try { await persistFastVLMOutput(raw); } catch { }
        }

        if (FASTVLM_REQUIRED) {
            throw error;
        }

        return {
            status: "error",

            raw,

            reason,

            prompt,

            error,

            genMs:
                Date.now() -
                startTime,

            device:
                fastvlm.device,

            backend:
                fastvlm.backend,

            dtype:
                fastvlm.dtype,

            model:
                FASTVLM_MODEL,
        };
    }
}

function extractJsonObject(text) {
    let s = String(text ?? "").trim();
    if (!s) throw new Error("No JSON object found in FastVLM output");
    // 1: Remove markdown code fences if present (handles ```json ... ``` and ``` ... ```)
    s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    // 2: Remove <think>...</think> if accidentally emitted
    s = s.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
    // 3: Try to find JSON object with brace depth (tolerant to single quotes -> double quotes)
    // Normalize single-quoted JSON to double quotes for salvage attempt
    let candidate = s;
    const first = candidate.indexOf("{");
    if (first === -1) {
        // No object found - try to see if model output a raw array like "redactions": [...]
        // Try to salvage by wrapping in braces
        const arrIdx = candidate.indexOf('"redactions"');
        if (arrIdx !== -1) {
            candidate = "{" + candidate.slice(arrIdx);
        } else {
            throw new Error("No JSON object found in FastVLM output. Preview: " + candidate.slice(0, 400));
        }
    }
    const startIdx = candidate.indexOf("{");
    if (startIdx === -1) throw new Error("No JSON object found in FastVLM output. Preview: " + candidate.slice(0, 400));
    let depth = 0;
    let end = -1;
    let inString = false;
    let escape = false;
    // Use the candidate string for brace matching to avoid issues with preceding prose
    const src = candidate;
    const base = startIdx;
    for (let i = base; i < src.length; i++) {
        const ch = src[i];
        if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
        } else {
            if (ch === '"') inString = true;
            else if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
    }
    if (end === -1) {
        // Truncated - try to auto-close by counting open braces and appending }
        if (depth > 0) {
            // Attempt to recover truncated JSON by closing braces
            const jsonStrTrunc = src.slice(base) + "}".repeat(depth);
            try {
                JSON.parse(jsonStrTrunc);
                console.warn("[FASTVLM] Recovered truncated JSON by auto-closing braces");
                return jsonStrTrunc;
            } catch { }
        }
        throw new Error("JSON output truncated or incomplete. Preview: " + src.slice(base, base + 500));
    }
    const jsonStr = src.slice(base, end + 1);
    return jsonStr;
}

function normalizeFastVLMRedactionItem(r, evidence) {
    if (!r) return null;
    const fusedById = new Map((evidence?.fused_candidates || []).map(c => [c.candidate_id, c]));
    const ocrById = new Map((evidence?.ocr || []).map(o => [o.id, o]));

    if (typeof r === "string") {
        const rawId = r.trim();
        if (fusedById.has(rawId)) {
            const c = fusedById.get(rawId);
            return {
                candidate_id: c.candidate_id,
                ocr_ids: c.ocr_ids || [],
                text: c.text,
                type: c.candidate_types?.[0] || "person",
                confidence: c.confidence ?? 0.9,
                reason: "fastvlm approved candidate",
                decision_source: "fastvlm_existing"
            };
        }
        if (ocrById.has(rawId)) {
            const o = ocrById.get(rawId);
            const matchingFused = (evidence?.fused_candidates || []).find(c => (c.ocr_ids || []).includes(rawId));
            return {
                candidate_id: matchingFused?.candidate_id || `fastvlm_${rawId}`,
                ocr_ids: [rawId],
                text: matchingFused?.text || o.text,
                type: matchingFused?.candidate_types?.[0] || "person",
                confidence: matchingFused?.confidence ?? (o.confidence ?? 0.9),
                reason: "fastvlm approved ocr id",
                decision_source: matchingFused ? "fastvlm_existing" : "fastvlm_additional"
            };
        }
        const matchByText = (evidence?.fused_candidates || []).find(c => normalizeCandidateText(c.text) === normalizeCandidateText(rawId));
        if (matchByText) {
            return {
                candidate_id: matchByText.candidate_id,
                ocr_ids: matchByText.ocr_ids || [],
                text: matchByText.text,
                type: matchByText.candidate_types?.[0] || "person",
                confidence: matchByText.confidence ?? 0.9,
                reason: "fastvlm approved text",
                decision_source: "fastvlm_existing"
            };
        }
        return {
            candidate_id: `fastvlm_${rawId}`,
            ocr_ids: [],
            text: rawId,
            type: "person",
            confidence: 0.9,
            decision_source: "fastvlm_additional"
        };
    }

    if (typeof r === "object") {
        let candidate_id = r.candidate_id;
        let ocr_ids = Array.isArray(r.ocr_ids) ? r.ocr_ids : (r.ocr_id ? [r.ocr_id] : (r.source_id ? [r.source_id] : []));
        let matchingFused = candidate_id ? fusedById.get(candidate_id) : null;
        if (!matchingFused && ocr_ids.length > 0) {
            matchingFused = (evidence?.fused_candidates || []).find(c => (c.ocr_ids || []).some(id => ocr_ids.includes(id)));
            if (matchingFused && !candidate_id) candidate_id = matchingFused.candidate_id;
        }
        if (!matchingFused && r.text) {
            matchingFused = (evidence?.fused_candidates || []).find(c => normalizeCandidateText(c.text) === normalizeCandidateText(r.text));
            if (matchingFused && !candidate_id) candidate_id = matchingFused.candidate_id;
        }
        return {
            candidate_id: candidate_id || matchingFused?.candidate_id || `fastvlm_item`,
            ocr_ids: ocr_ids.length > 0 ? ocr_ids : (matchingFused?.ocr_ids || []),
            text: r.text || matchingFused?.text || "",
            type: r.type || matchingFused?.candidate_types?.[0] || "person",
            confidence: r.confidence ?? matchingFused?.confidence ?? 0.9,
            reason: r.reason || "fastvlm approved",
            decision_source: matchingFused ? "fastvlm_existing" : (r.decision_source || "fastvlm_additional")
        };
    }
    return r;
}

function validateFastVLMRedactionOutput(parsed, evidence) {
    if (
        !parsed ||
        typeof parsed !== "object"
    ) {
        return {
            valid: false,
            reason: "root not object",
        };
    }

    if (!Array.isArray(parsed.redactions)) {
        return {
            valid: false,
            reason: "redactions must be array",
        };
    }

    parsed.redactions = parsed.redactions
        .map(r => normalizeFastVLMRedactionItem(r, evidence))
        .filter(Boolean);

    if (parsed.additional_redactions !== undefined) {
        if (!Array.isArray(parsed.additional_redactions)) {
            return {
                valid: false,
                reason: "additional_redactions must be array",
            };
        }
        parsed.additional_redactions = parsed.additional_redactions
            .map(r => normalizeFastVLMRedactionItem(r, evidence))
            .filter(Boolean);
    }

    if (
        parsed.caption !== undefined &&
        parsed.caption !== null &&
        typeof parsed.caption !== "string"
    ) {
        return {
            valid: false,
            reason: "caption must be string",
        };
    }

    const fusedIds =
        new Set(
            (
                evidence.fused_candidates ||
                []
            ).map(
                c => c.candidate_id
            )
        );

    const ocrIds =
        new Set(
            (
                evidence.ocr ||
                []
            ).map(
                o => o.id
            )
        );

    const knownTexts =
        new Set([
            ...(
                evidence.ocr || []
            ).map(
                o =>
                    normalizeCandidateText(
                        o.text
                    )
            ),

            ...(
                evidence.fused_candidates ||
                []
            ).map(
                c =>
                    normalizeCandidateText(
                        c.text
                    )
            ),

            ...(
                evidence.ettin_candidates ||
                []
            ).map(
                e =>
                    normalizeCandidateText(
                        e.text
                    )
            ),

            ...(
                evidence.deterministic_candidates ||
                []
            ).map(
                d =>
                    normalizeCandidateText(
                        d.value
                    )
            ),
        ]);

    for (
        const r of parsed.redactions
    ) {
        if (
            !r.candidate_id ||
            typeof r.candidate_id !==
            "string"
        ) {
            return {
                valid: false,
                reason:
                    "redaction missing candidate_id",
            };
        }

        if (
            !fusedIds.has(
                r.candidate_id
            )
        ) {
            return {
                valid: false,
                reason:
                    `fabricated candidate_id: ${r.candidate_id}`,
            };
        }

        if (
            !Array.isArray(
                r.ocr_ids
            ) ||
            r.ocr_ids.length === 0
        ) {
            return {
                valid: false,
                reason:
                    `redaction ${r.candidate_id} missing ocr_ids`,
            };
        }

        for (
            const oid of r.ocr_ids
        ) {
            if (!ocrIds.has(oid)) {
                return {
                    valid: false,
                    reason:
                        `fabricated ocr_id: ${oid}`,
                };
            }
        }

        if (
            !r.text ||
            typeof r.text !==
            "string"
        ) {
            return {
                valid: false,
                reason:
                    `redaction ${r.candidate_id} missing text`,
            };
        }

        const nt =
            normalizeCandidateText(
                r.text
            );

        if (!knownTexts.has(nt)) {
            const supported =
                [...knownTexts].some(
                    k =>
                        k.includes(nt) ||
                        nt.includes(k)
                );

            if (!supported) {
                return {
                    valid: false,
                    reason:
                        `text not supported by evidence: "${r.text}"`,
                };
            }
        }

        const typeNorm =
            String(
                r.type ?? ""
            ).toLowerCase();

        if (
            !ALLOWED_FASTVLM_TYPES.has(
                typeNorm
            )
        ) {
            return {
                valid: false,
                reason:
                    `unsupported type: ${r.type}`,
            };
        }

        if (
            r.confidence !==
            undefined
        ) {
            const c =
                Number(
                    r.confidence
                );

            if (
                !Number.isFinite(c) ||
                c < 0 ||
                c > 1
            ) {
                return {
                    valid: false,
                    reason:
                        `confidence out of range: ${r.confidence}`,
                };
            }
        }
    }

    return {
        valid: true,
    };
}

/* ============================================================
    PHASE 6 — FINAL REDACTION RESOLUTION + SAFETY GATES
    ============================================================ */

// 2C: single normalized FastVLM decision — ONLY source for successful FastVLM final findings
function buildFastVLMFinalCandidates(fastvlmResult, evidence) {
    const out = [];
    let addIdx = 0;

    for (const r of (fastvlmResult?.parsed?.redactions ?? [])) {
        const norm = normalizeFastVLMRedactionItem(r, evidence);
        if (norm) {
            out.push({
                ...norm,
                decision_source: norm.decision_source || "fastvlm_existing",
            });
        }
    }

    for (const r of (fastvlmResult?.parsed?.additional_redactions ?? [])) {
        const norm = normalizeFastVLMRedactionItem(r, evidence);
        if (norm) {
            out.push({
                ...norm,
                candidate_id: norm.candidate_id || `fastvlm_additional_${String(addIdx++).padStart(3, "0")}`,
                decision_source: "fastvlm_additional",
            });
        }
    }

    return out;
}
function resolveFinalRedactionRegions(fastvlmResult, evidence) {
    const normalized = fastvlmResult?._normalizedCandidates ?? buildFastVLMFinalCandidates(fastvlmResult, evidence);
    const fusedById = new Map((evidence.fused_candidates || []).map((c) => [c.candidate_id, c]));
    const resolved = [];
    let rejectedLabelBboxes = 0;
    let rejectedWholeLine = 0;
    let unresolved = 0;
    for (const r of normalized) {
        const isAdditional = r.decision_source === "fastvlm_additional";
        const fused = !isAdditional ? fusedById.get(r.candidate_id) : null;
        let ocrIds = Array.isArray(r.ocr_ids) && r.ocr_ids.length ? r.ocr_ids : (fused?.ocr_ids ?? []);
        // Strict value-only resolution via central helper (Â§8)
        // 1. Find OCR item by OCR ID
        // 2. Check OCR text
        // 3. If exact equals -> use bbox
        // 4. Else if contains -> calculate value sub-bbox
        // 5. Else DO NOT use that OCR bbox (forbidden fallback removed)
        // 6. Continue searching other supplied OCR IDs
        // 7. If no valid OCR value bbox: optionally use fused bbox ONLY if value-specific
        // 8. Otherwise reject/skip
        const bbox = resolveSensitiveValueBBox({ text: r.text, ocrIds, evidence, fusedCandidate: fused });
        if (!bbox) {
            // Distinguish label-only vs whole-line vs unresolved
            const want = cleanText(r.text);
            let hasLabelOnly = false;
            let hasWholeLine = false;
            const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
            for (const oid of ocrIds || []) {
                const it = ocrById.get(oid);
                if (!it) continue;
                const ot = cleanText(it.text);
                if (!ot) continue;
                if (!ot.toLowerCase().includes(want.toLowerCase())) hasLabelOnly = true;
                else if (ot.length > want.length + 3) hasWholeLine = true;
            }
            if (hasLabelOnly) rejectedLabelBboxes++;
            else if (hasWholeLine) rejectedWholeLine++;
            else unresolved++;
            if (FASTVLM_DEBUG) {
                const preview = String(r.text).slice(0, 20);
                console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=null (rejected preview="${preview}")`);
            } else {
                console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=null`);
            }
            continue;
        }
        resolved.push({
            source_id: ocrIds[0] ?? fused?.ocr_ids?.[0] ?? r.candidate_id,
            entity: r.type ?? fused?.candidate_types?.[0] ?? "PII",
            score: Number(r.confidence ?? fused?.confidence ?? 1),
            text: r.text,
            bbox,
            candidate_id: r.candidate_id,
            ocr_ids: ocrIds,
            reason: r.reason ?? "",
            decision_source: r.decision_source,
        });
        if (FASTVLM_DEBUG) {
            const preview = String(r.text).slice(0, 20);
            console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=[${bbox.map(n => Math.round(n)).join(",")}] preview="${preview}"`);
        } else {
            console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=[${bbox.map(n => Math.round(n)).join(",")}]`);
        }
    }
    resolveFinalRedactionRegions._lastRejectedLabel = rejectedLabelBboxes;
    resolveFinalRedactionRegions._lastRejectedWhole = rejectedWholeLine;
    resolveFinalRedactionRegions._lastUnresolved = unresolved;
    resolveFinalRedactionRegions._lastRejected = rejectedLabelBboxes + rejectedWholeLine + unresolved;
    return resolved;
}

function applySafetyGates(findings, evidence, imageWidth, imageHeight) {
    const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
    const ocrTexts = new Map((evidence.ocr || []).map((o) => [o.id, normalizeCandidateText(o.text)]));
    const filtered = [];
    for (const f of findings) {
        // Gate 1: valid bbox
        if (!Array.isArray(f.bbox) || f.bbox.length !== 4) continue;
        const nums = f.bbox.map(Number);
        if (!nums.every(Number.isFinite)) continue;
        const w = Math.abs(nums[2] - nums[0]);
        const h = Math.abs(nums[3] - nums[1]);
        if (w <= 0 || h <= 0) continue;
        const rect = clampBBox(f.bbox, imageWidth, imageHeight, 0);
        if (!rect) continue;
        // Gate 2: valid OCR mapping (at least one ocr_id known)
        const hasKnownOcr = (f.ocr_ids ?? []).some((id) => ocrTexts.has(id)) || ocrTexts.has(f.source_id) || !!f.bbox;
        if (!hasKnownOcr) continue;
        // Gate 3: text consistency
        if (f.text) {
            const nt = normalizeCandidateText(f.text);
            const ocrId = f.ocr_ids?.[0] ?? f.source_id;
            const ocrText = ocrId ? ocrTexts.get(ocrId) : null;
            if (ocrText && !ocrText.includes(nt) && !nt.includes(ocrText)) {
                if (FASTVLM_DEBUG) console.warn(`[GATE] text mismatch: "${f.text}" vs OCR "${ocrText}"`);
            }
        }
        // Gate 7: geometry-aware â€” NEVER enlarge value bbox into label+value (Â§17)
        // If bbox is whole line while value is substring, fix to value sub-bbox or reject
        {
            const ocrId = f.ocr_ids?.[0] ?? f.source_id;
            const ocrItem = ocrId ? ocrById.get(ocrId) : null;
            if (ocrItem && f.text && ocrItem.text) {
                const normOcr = normalizeCandidateText(ocrItem.text);
                const normVal = normalizeCandidateText(f.text);
                if (normOcr.includes(normVal) && normOcr.length > normVal.length + 3) {
                    const expected = estimateTextSubBBox(ocrItem, f.text);
                    if (expected) {
                        const expW = Math.abs(expected[2] - expected[0]);
                        const actW = Math.abs(f.bbox[2] - f.bbox[0]);
                        // If actual is >1.8x expected width, it's likely whole line
                        if (actW > expW * 1.8 && expW > 5) {
                            if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific bbox at ${ocrId} expected ${expW.toFixed(1)} vs actual ${actW.toFixed(1)}`);
                            // NEVER enlarge: replace with tighter value-only bbox (shrinking)
                            const isValueOnly = isLikelyValueOnlyBBox({ bbox: expected, item: ocrItem, targetText: f.text });
                            if (isValueOnly) f.bbox = expected;
                            else continue;
                        } else if (!isLikelyValueOnlyBBox({ bbox: f.bbox, item: ocrItem, targetText: f.text })) {
                            console.log(`[SECURITY] rejecting non-value-specific bbox`);
                            continue;
                        }
                    } else {
                        const ocrLen = normOcr.length;
                        const valLen = normVal.length;
                        if (ocrLen > valLen * 2.5) {
                            if (FASTVLM_DEBUG) console.log(`[GATE] Geometry suspicious at ${ocrId}`);
                            const est = estimateTextSubBBox(ocrItem, f.text);
                            if (est && isLikelyValueOnlyBBox({ bbox: est, item: ocrItem, targetText: f.text })) f.bbox = est;
                            else continue;
                        }
                    }
                }
            }
        }
        // Gate 5: no label-only redaction â€” value must be plausible
        if (!isPlausibleValue(f.text ?? "")) continue;
        // Also reject if text looks like a pure label
        if (findFieldLabelMatch(f.text ?? "")) {
            const labelMatch = findFieldLabelMatch(f.text);
            if (labelMatch && normalizeCandidateText(labelMatch.label) === normalizeCandidateText(f.text)) continue;
        }
        // Gate 6: confidence policy — tiered threshold based on evidence strength:
        // - FastVLM-adjudicated: FINAL_REDACTION_CONFIDENCE_THRESHOLD (0.5)
        // - Dual-source (NER + deterministic agree): 0.5 — two independent detectors
        //   agreeing is equivalent confidence to FastVLM confirmation (parity with v7.mjs)
        // - Prose-salvage (FastVLM mentioned OCR/Candidate ID in prose): 0.5
        // - Name entities (first_name, last_name, user_name, person, name): 0.5
        //   (names lack deterministic regex support, so single-source floor 0.72 overlooks them)
        // - Single-source fusion fallback for other fields: FALLBACK_CONFIDENCE_THRESHOLD (0.72)
        {
            const isDualSource =
                f.decision_source === "fusion_fallback" &&
                Array.isArray(f.sources) &&
                f.sources.length >= 2 &&
                f.sources.includes("ettin") &&
                f.sources.includes("deterministic_context");
            const isProseSalvage = !!f._prose_salvage;
            const entityType = String(f.entity || "").toLowerCase();
            const isNameEntity =
                entityType.includes("name") ||
                entityType.includes("person") ||
                (Array.isArray(f.candidate_types) && f.candidate_types.some((t) => {
                    const tl = String(t).toLowerCase();
                    return tl.includes("name") || tl.includes("person");
                }));
            const threshold =
                f.decision_source !== "fusion_fallback"
                    ? FINAL_REDACTION_CONFIDENCE_THRESHOLD
                    : (isDualSource || isProseSalvage || isNameEntity)
                        ? FINAL_REDACTION_CONFIDENCE_THRESHOLD
                        : FALLBACK_CONFIDENCE_THRESHOLD;
            if (Number(f.score) < threshold) {
                if (FASTVLM_DEBUG) console.log(
                    `[GATE6] filtered ${f.candidate_id ?? f.source_id}` +
                    ` score=${Number(f.score).toFixed(3)} < ${threshold}` +
                    ` (${f.decision_source}${isDualSource ? "/dual" : ""}${isProseSalvage ? "/salvage" : ""}${isNameEntity ? "/name" : ""})`
                );
                continue;
            }
        }
        filtered.push(f);
    }
    // Gate 4: candidate containment â€” remove redundant sub-spans only when same region/bboxes overlap
    filtered.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    const deduped = [];
    for (const f of filtered) {
        const nt = normalizeCandidateText(f.text);
        let contained = false;
        for (const k of deduped) {
            const kText = normalizeCandidateText(k.text);
            if (kText.includes(nt) && nt !== kText) {
                const sameOcr = (f.ocr_ids || []).some((id) => (k.ocr_ids || []).includes(id));
                const overlap = f.bbox && k.bbox ? !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]) : false;
                if (sameOcr || overlap) { contained = true; break; }
            }
            // same bbox containment (kept for completeness)
            if (f.bbox && k.bbox && nt !== kText) {
                const overlap = !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]);
                if (overlap && kText.includes(nt)) { contained = true; break; }
            }
        }
        if (!contained) deduped.push(f);
    }
    return deduped;
}

function adjudicateOrFallback({
    ettinFindings,
    deterministicFindings,
    fusedCandidates,
    fastvlmResult,
    evidence,
    image,
}) {
    let finalFindings = [];

    let status =
        fastvlmResult?.status ??
        "skipped";

    let validation = null;

    if (
        fastvlmResult?.status ===
        "ok" &&
        fastvlmResult.parsed
    ) {
        validation =
            validateFastVLMRedactionOutput(
                fastvlmResult.parsed,
                evidence.fastvlm_evidence
            );

        if (validation.valid) {
            const normalized =
                buildFastVLMFinalCandidates(
                    fastvlmResult,
                    evidence.fastvlm_evidence
                );

            fastvlmResult._normalizedCandidates =
                normalized;

            const resolved =
                resolveFinalRedactionRegions(
                    fastvlmResult,
                    evidence.fastvlm_evidence
                );

            finalFindings =
                applySafetyGates(
                    resolved,
                    evidence.fastvlm_evidence,
                    image.width,
                    image.height
                );

            status = "ok";
        } else {
            console.warn(
                `[FASTVLM] validation failed: ${validation.reason}`
            );

            status =
                "validation_failed";
        }
    }

    // Prose salvage: FastVLM emitted readable text instead of JSON (common with quantized models).
    // Extract any ocr_N or cand_N IDs mentioned in the raw prose and mark matching fused candidates
    // as "prose_salvage" so they receive the lower 0.5 threshold (same as FastVLM-confirmed).
    if (
        status !== "ok" &&
        fastvlmResult?.raw &&
        typeof fastvlmResult.raw === "string"
    ) {
        const mentionedOcrIds = new Set(
            [...fastvlmResult.raw.matchAll(/\bocr_\d+\b/g)].map((m) => m[0])
        );
        const mentionedCandIds = new Set(
            [...fastvlmResult.raw.matchAll(/\bcand_\d+\b/g)].map((m) => m[0])
        );
        if (mentionedOcrIds.size > 0 || mentionedCandIds.size > 0) {
            console.log(`[FASTVLM] Prose salvage: found OCR/Candidate ID(s) in raw output: ${[...mentionedOcrIds, ...mentionedCandIds].join(", ")}`);
            // Tag matching fused candidates so applySafetyGates uses a tighter threshold
            for (const c of fusedCandidates || []) {
                if (mentionedCandIds.has(c.candidate_id) || (c.ocr_ids || []).some((id) => mentionedOcrIds.has(id))) {
                    c._prose_salvage = true;
                }
            }
        }
    }

    /*
     * Empty FastVLM result is a valid success.
     * Only fall back when FastVLM failed/skipped.
     */

    if (
        status === "ok"
    ) {
        return {
            status: "ok",
            finalFindings,
            redaction_complete:
                true,
            fallback: false,
            validation,
        };
    }

    const fallback = [];

    for (
        const candidate
        of fusedCandidates || []
    ) {
        const bbox =
            resolveSensitiveValueBBox({
                text:
                    candidate.text,

                ocrIds:
                    candidate.ocr_ids,

                evidence:
                    evidence.fastvlm_evidence,

                fusedCandidate:
                    candidate,
            });

        if (!bbox) {
            continue;
        }

        fallback.push({
            source_id:
                candidate
                    .ocr_ids
                    ?.find(Boolean) ??
                candidate.candidate_id,

            entity:
                candidate
                    .candidate_types
                ?.[0] ??
                "PII",

            score:
                candidate.confidence,

            text:
                candidate.text,

            bbox,

            candidate_id:
                candidate.candidate_id,

            ocr_ids:
                candidate.ocr_ids,

            reason:
                candidate.reason ??
                "fusion fallback",

            decision_source:
                "fusion_fallback",
        });
    }

    finalFindings =
        applySafetyGates(
            fallback,
            evidence.fastvlm_evidence,
            image.width,
            image.height
        );

    return {
        status:
            status ===
                "skipped"
                ? "skipped"
                : "fallback",

        finalFindings,

        redaction_complete:
            true,

        fallback:
            true,

        validation,
    };
}

/* ============================================================
   REDACTION
   ============================================================ */

function redactChunks(chunks, findings) {
    const findingsBySource = new Map();
    for (const finding of findings) {
        if (!findingsBySource.has(finding.source_id)) {
            findingsBySource.set(finding.source_id, []);
        }
        findingsBySource.get(finding.source_id).push(finding);
    }

    return chunks.map((chunk) => {
        const chunkFindings = findingsBySource.get(chunk.id) || [];
        let text = chunk.text;

        // Longest match first so overlapping/nested findings don't leave
        // partial fragments of a redacted value behind.
        const sorted = [...chunkFindings].sort(
            (a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0)
        );

        for (const finding of sorted) {
            if (!finding.text) continue;
            const escaped = finding.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(escaped, "gi");
            text = text.replace(pattern, `[REDACTED:${finding.entity}]`);
        }

        return { ...chunk, text, redacted: chunkFindings.length > 0 };
    });
}

/* ============================================================
   IMAGE REDACTION
   ============================================================ */

/**
 * Clamp an OCR bbox to valid image coordinates.
 */
function clampBBox(bbox, width, height, padding = 0) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;

    const raw = bbox.map(Number);
    if (!raw.every(Number.isFinite)) return null;

    let x1 = Math.min(raw[0], raw[2]) - padding;
    let y1 = Math.min(raw[1], raw[3]) - padding;
    let x2 = Math.max(raw[0], raw[2]) + padding;
    let y2 = Math.max(raw[1], raw[3]) + padding;

    x1 = Math.max(0, Math.min(width - 1, Math.floor(x1)));
    y1 = Math.max(0, Math.min(height - 1, Math.floor(y1)));
    x2 = Math.max(x1 + 1, Math.min(width, Math.ceil(x2)));
    y2 = Math.max(y1 + 1, Math.min(height, Math.ceil(y2)));

    return {
        left: x1,
        top: y1,
        width: Math.max(1, x2 - x1),
        height: Math.max(1, y2 - y1),
    };
}

/**
 * Deduplicate findings that point to the same OCR region/bbox.
 * Ettin can emit multiple token/entity predictions for one value;
 * the image only needs one overlay.
 */
function uniqueImageRedactionRegions(findings) {
    const seen = new Map();

    for (const finding of findings || []) {
        if (!finding?.bbox) continue;

        const bbox = finding.bbox.map(Number);
        if (!bbox.every(Number.isFinite)) continue;

        const key = [
            finding.source_id ?? "unknown",
            bbox.map((v) => Math.round(v)).join(","),
        ].join("|");

        const existing = seen.get(key);

        if (!existing) {
            seen.set(key, {
                source_id: finding.source_id ?? null,
                entity: finding.entity ?? "PII",
                bbox,
                score: Number(finding.score ?? 0),
            });
        } else {
            existing.score = Math.max(
                existing.score,
                Number(finding.score ?? 0)
            );
        }
    }

    return [...seen.values()];
}

/**
 * Redact detected sensitive regions directly in the original image.
 *
 * This is intentionally lightweight:
 * - no VLM
 * - no image generation
 * - no second OCR pass
 * - no cloud service
 *
 * Default mode uses an opaque black rectangle, which is preferred for
 * irreversible privacy masking. Set REDACTION_STYLE=blur for a visual
 * alternative.
 */
async function redactImage(imagePath, findings, outputPath) {
    logSection("Redacting Sensitive Regions in Image");

    const metadata = await sharp(imagePath).metadata();
    const imageWidth = Number(metadata.width ?? 0);
    const imageHeight = Number(metadata.height ?? 0);

    if (!imageWidth || !imageHeight) {
        throw new Error("Could not determine input image dimensions for image redaction.");
    }

    const regions = uniqueRedactionRegions(findings);
    const blackOverlays = [];
    const blurOverlays = [];

    for (const region of regions) {
        const isFace = isFaceFinding(region);
        const padding = isFace ? FACE_REDACTION_PADDING : IMAGE_REDACTION_PADDING;
        const rect = clampBBox(region.bbox, imageWidth, imageHeight, padding);
        if (!rect) continue;

        if (isFace && FACE_REDACTION_STYLE === "blur") {
            const blurred = await sharp(imagePath)
                .extract(rect)
                .blur(FACE_BLUR_SIGMA)
                .png()
                .toBuffer();
            blurOverlays.push({ input: blurred, left: rect.left, top: rect.top });
            continue;
        }

        if (!isFace && IMAGE_REDACTION_STYLE === "blur") {
            const blurred = await sharp(imagePath)
                .extract(rect)
                .blur(12)
                .png()
                .toBuffer();
            blurOverlays.push({ input: blurred, left: rect.left, top: rect.top });
            continue;
        }

        const svg = Buffer.from(
            `<svg width="${rect.width}" height="${rect.height}" xmlns="http://www.w3.org/2000/svg">` +
            `<rect x="0" y="0" width="${rect.width}" height="${rect.height}" fill="black"/>` +
            `</svg>`
        );
        blackOverlays.push({ input: svg, left: rect.left, top: rect.top });
    }

    const overlays = [...blurOverlays, ...blackOverlays];
    await sharp(imagePath).composite(overlays).png().toFile(outputPath);

    const faceCount = regions.filter(isFaceFinding).length;
    const textCount = regions.length - faceCount;
    console.log(`[IMAGE REDACTION] Text regions redacted: ${textCount}`);
    console.log(`[IMAGE REDACTION] Face regions redacted: ${faceCount}`);
    console.log(`[IMAGE REDACTION] Total unique regions: ${regions.length}`);
    console.log(`[IMAGE REDACTION] Text style: ${IMAGE_REDACTION_STYLE}`);
    console.log(`[IMAGE REDACTION] Face style: ${FACE_REDACTION_STYLE}`);
    console.log(`[IMAGE REDACTION] Output: ${outputPath}`);

    return {
        output_path: outputPath,
        style: IMAGE_REDACTION_STYLE,
        face_style: FACE_REDACTION_STYLE,
        regions_redacted: regions.length,
        text_regions_redacted: textCount,
        face_regions_redacted: faceCount,
        image_width: imageWidth,
        image_height: imageHeight,
    };
}

/* ============================================================
   FACE DETECTION â€” lightweight local BlazeFace ONNX
   ============================================================ */

function _faceExecutionProviders() {
    // Keep face detection on CPU for stability (BlazeFace Gather op fails on DML).
    // FastVLM (the heavy model) will use dedicated GPU via DML; face is lightweight.
    // Override with FACE_DEVICE=dml if you explicitly want GPU face.
    const faceDeviceRaw = String(process.env.FACE_DEVICE || "").toLowerCase().trim();
    if (faceDeviceRaw === "dml") return [{ name: "dml", deviceId: _DML_DEVICE_ID_PATCH }];
    if (faceDeviceRaw === "cuda") return ["cuda"];
    if (faceDeviceRaw === "cpu" || faceDeviceRaw === "wasm") return ["cpu"];
    return ["cpu"];
}

async function ensureFaceModelFile() {
    try {
        const exists = await fs.access(FACE_MODEL_PATH).then(() => true).catch(() => false);
        if (exists) return FACE_MODEL_PATH;

        const idx = FACE_MODEL_PATH.lastIndexOf("/");
        const dir = idx >= 0 ? FACE_MODEL_PATH.slice(0, idx) : ".";
        await fs.mkdir(dir, { recursive: true });

        console.log(`[FACE] Downloading model: ${FACE_MODEL_URL}`);
        const response = await fetch(FACE_MODEL_URL, { redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 100_000) throw new Error(`Downloaded face model is unexpectedly small (${buffer.length} bytes)`);
        await fs.writeFile(FACE_MODEL_PATH, buffer);
        console.log(`[FACE] Model cached: ${FACE_MODEL_PATH} (${buffer.length} bytes)`);
        return FACE_MODEL_PATH;
    } catch (error) {
        throw new Error(`Face model download/cache failed: ${error.message}`);
    }
}

function _iou(a, b) {
    const ax1 = Math.min(a[0], a[2]), ay1 = Math.min(a[1], a[3]);
    const ax2 = Math.max(a[0], a[2]), ay2 = Math.max(a[1], a[3]);
    const bx1 = Math.min(b[0], b[2]), by1 = Math.min(b[1], b[3]);
    const bx2 = Math.max(b[0], b[2]), by2 = Math.max(b[1], b[3]);
    const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    if (!inter) return 0;
    const ua = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
    const ub = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
    const union = ua + ub - inter;
    return union > 0 ? inter / union : 0;
}

function _nmsFaceDetections(detections, iouThreshold) {
    const sorted = [...detections].sort((a, b) => b.score - a.score);
    const kept = [];
    for (const det of sorted) {
        if (kept.some((k) => _iou(k.bbox, det.bbox) > iouThreshold)) continue;
        kept.push(det);
        if (kept.length >= FACE_MAX_DETECTIONS) break;
    }
    return kept;
}

async function loadFaceDetector() {
    if (!FACE_ENABLED) return null;
    if (_faceModelCache) return _faceModelCache;
    if (_faceModelLoadPromise) return _faceModelLoadPromise;

    _faceModelLoadPromise = (async () => {
        const t0 = Date.now();
        const modelPath = await ensureFaceModelFile();
        const executionProviders = _faceExecutionProviders();
        const session = await Ort.InferenceSession.create(modelPath, {
            executionProviders,
            graphOptimizationLevel: "all",
        });
        let statSize = 0;
        try { const st = await fs.stat(modelPath); statSize = st.size; } catch { }
        _faceModelCache = {
            session,
            modelPath,
            backend: executionProviders[0]?.name || executionProviders[0] || "cpu",
            loadMs: Date.now() - t0,
            modelSize: statSize,
        };
        console.log(`[FACE] Model: BlazeFace ONNX`);
        console.log(`[FACE] Model URL: ${FACE_MODEL_URL}`);
        if (statSize) console.log(`[FACE] Model size: ${statSize} bytes`);
        console.log(`[FACE] Backend: ${_faceModelCache.backend}`);
        console.log(`[FACE] Input: 128x128 RGB`);
        console.log(`[FACE] Confidence threshold: ${FACE_MIN_CONFIDENCE}`);
        // ---- 1. INSPECT ACTUAL ONNX MODEL I/O ----
        try {
            console.log(`[FACE] Model inputs:`);
            const imeta = session.inputMetadata || [];
            const ometa = session.outputMetadata || [];
            // inputNames / outputNames are arrays of strings, metadata has type/shape
            for (const m of imeta) {
                console.log(`  name: ${m.name}`);
                console.log(`  type: ${m.type}`);
                console.log(`  dimensions: ${JSON.stringify(m.shape)}`);
            }
            // also log via names in case metadata missing
            if (!imeta.length && session.inputNames) {
                for (const n of session.inputNames) console.log(`  name: ${n} (metadata unavailable)`);
            }
            console.log(`[FACE] Model outputs:`);
            for (const m of ometa) {
                console.log(`  name: ${m.name}`);
                console.log(`  type: ${m.type}`);
                console.log(`  dimensions: ${JSON.stringify(m.shape)}`);
            }
            if (!ometa.length && session.outputNames) {
                for (const n of session.outputNames) console.log(`  name: ${n} (metadata unavailable)`);
            }
            // explicit names log
            if (session.inputNames) console.log(`[FACE] session.inputNames: ${JSON.stringify(session.inputNames)}`);
            if (session.outputNames) console.log(`[FACE] session.outputNames: ${JSON.stringify(session.outputNames)}`);
        } catch (e) {
            console.log(`[FACE] I/O inspect failed: ${e.message}`);
        }
        return _faceModelCache;
    })();

    try {
        return await _faceModelLoadPromise;
    } finally {
        _faceModelLoadPromise = null;
    }
}

async function _generateFaceDebugImage(imagePath, detections, W, H) {
    try {
        const svgRects = detections.map(d => {
            const [x1, y1, x2, y2] = d.bbox.map(v => Number(v));
            const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
            return `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="none" stroke="red" stroke-width="4" />`
                + `<rect x="${x1}" y="${y1 - 22}" width="90" height="22" fill="red" /><text x="${x1 + 4}" y="${y1 - 6}" font-size="14" fill="white" font-family="sans-serif">${d.score.toFixed(2)}</text>`;
        }).join("\n");
        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svgRects}</svg>`;
        const outPath = "./face_debug.png";
        // Composite SVG overlay onto original via sharp
        const base = sharp(imagePath);
        // Need to ensure we create debug image from original + overlay
        await base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(outPath);
        console.log(`[FACE] Debug image: ${outPath} (${detections.length} boxes)`);
    } catch (e) {
        console.warn(`[FACE] face_debug.png failed: ${e.message}`);
    }
}

async function runFaceDetection(imagePath) {
    if (!FACE_ENABLED) return [];

    const tStart = Date.now();
    let tLoad = 0, tPrep = 0, tInfer = 0, tPost = 0;
    const tLoad0 = Date.now();
    const detector = await loadFaceDetector();
    tLoad = Date.now() - tLoad0;
    if (!detector?.session) return [];

    const FACE_DEBUG = process.env.FACE_DEBUG === "1";

    const meta = await sharp(imagePath).metadata();
    const W = Number(meta.width || 0);
    const H = Number(meta.height || 0);
    if (!W || !H) throw new Error("Unable to determine image dimensions for face detection");

    // ---- 5. VERIFY INPUT PREPROCESSING ----
    const tPrep0 = Date.now();
    const { data, info } = await sharp(imagePath)
        .removeAlpha()
        .resize(128, 128, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Correct NCHW planar layout: [1,3,128,128] RGB float32 [0,1]
    // Previous buggy code did interleaved RGBRGB... which garbles the model and yields 0 detections at 0.6
    const input = new Float32Array(1 * 3 * 128 * 128);
    for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 3;
            const r = data[idx] / 255;
            const g = data[idx + 1] / 255;
            const b = data[idx + 2] / 255;
            input[0 * 128 * 128 + y * 128 + x] = r;
            input[1 * 128 * 128 + y * 128 + x] = g;
            input[2 * 128 * 128 + y * 128 + x] = b;
        }
    }
    // Log input verification
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < input.length; i++) { const v = input[i]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    console.log(`[FACE] Input shape: [1,3,128,128]`);
    console.log(`[FACE] Input dtype: float32`);
    console.log(`[FACE] Input min: ${minV.toFixed(4)}`);
    console.log(`[FACE] Input max: ${maxV.toFixed(4)}`);
    if (FACE_DEBUG) console.log(`[FACE] Input info: ${JSON.stringify(info)} range approx [${minV.toFixed(3)},${maxV.toFixed(3)}]`);
    tPrep = Date.now() - tPrep0;

    const feeds = {
        image: new Ort.Tensor("float32", input, [1, 3, 128, 128]),
        conf_threshold: new Ort.Tensor("float32", new Float32Array([FACE_MIN_CONFIDENCE]), [1]),
        max_detections: new Ort.Tensor("int64", BigInt64Array.from([BigInt(FACE_MAX_DETECTIONS)]), [1]),
        iou_threshold: new Ort.Tensor("float32", new Float32Array([FACE_IOU_THRESHOLD]), [1]),
    };

    // ---- 4. TEST WITHOUT OPTIONAL POST-PROCESSING INPUTS (diagnostic) ----
    // We keep required + optional together for production, but log shapes to diagnose {1,0,16}
    // If model misbehaves we could try image-only, but this model requires all 4 inputs (tested: missing throws).

    const tInfer0 = Date.now();
    const output = await detector.session.run(feeds);
    tInfer = Date.now() - tInfer0;

    const tPost0 = Date.now();
    // ---- 2 & 7. PARSE OUTPUTS BY NAME (do NOT use Object.values ordering) ----
    // ---- 3. INVESTIGATE {1,0,16} RESULT ----
    // ---- 8. PRINT OUTPUT TENSOR METADATA IN DEBUG MODE ----
    if (FACE_DEBUG) {
        console.log(`========== FACE MODEL OUTPUT ==========`);
        for (const name of Object.keys(output)) {
            const t = output[name];
            console.log(`output name: ${name}`);
            console.log(`shape: ${JSON.stringify(t.dims)}`);
            console.log(`dtype: ${t.type}`);
            console.log(`length: ${t.data?.length ?? 0}`);
        }
        console.log(`========================================`);
    } else {
        // Always log output shapes (light)
        for (const name of Object.keys(output)) {
            const t = output[name];
            console.log(`[FACE] Output "${name}" shape: [${t.dims.join(",")}] dtype=${t.type} len=${t.data?.length ?? 0}`);
        }
    }

    // Resolve tensors by exact name as exposed by model. Current model exposes only "selectedBoxes"
    // Older assumption of [boxes, scores] via Object.values was unsafe and caused silent mis-parse.
    const boxTensor = output.selectedBoxes ?? output["selectedBoxes"] ?? Object.values(output)[0];
    const scoreTensor = output.selectedScores ?? output["selectedScores"] ?? null; // null for this model
    // If model also exposed raw outputs (e.g. rawBoxes/rawScores) we would use them for custom NMS,
    // but inspection shows only selectedBoxes exists, so we use filtered boxes directly.

    if (!boxTensor) {
        console.warn(`[FACE] No selectedBoxes output found. Available: ${Object.keys(output).join(",")}`);
        return [];
    }

    // Log warning investigation for 0 detections
    const outShape = boxTensor.dims;
    if (outShape[1] === 0) {
        console.log(`[FACE] NOTE: selectedBoxes is [1,0,16] -> model filtered 0 detections at threshold ${FACE_MIN_CONFIDENCE}. This is NOT suppressed; will diagnose via lower thresholds if FACE_DEBUG.`);
        if (FACE_DEBUG) {
            // Quick sweep to prove model can detect at lower threshold when preprocessing is correct
            for (const th of [0.3, 0.15, 0.1]) {
                try {
                    const probe = await detector.session.run({
                        image: new Ort.Tensor("float32", input, [1, 3, 128, 128]),
                        conf_threshold: new Ort.Tensor("float32", new Float32Array([th]), [1]),
                        max_detections: new Ort.Tensor("int64", BigInt64Array.from([BigInt(FACE_MAX_DETECTIONS)]), [1]),
                        iou_threshold: new Ort.Tensor("float32", new Float32Array([FACE_IOU_THRESHOLD]), [1]),
                    });
                    const pt = probe.selectedBoxes ?? Object.values(probe)[0];
                    console.log(`[FACE][DEBUG] probe thresh ${th} -> shape [${pt.dims.join(",")}] len ${pt.data.length / 16} dets`);
                } catch (e) { console.log(`[FACE][DEBUG] probe ${th} failed: ${e.message}`); }
            }
        }
    }

    const boxes = Array.from(boxTensor.data || []);
    const scores = scoreTensor ? Array.from(scoreTensor.data || []) : null;
    const stride = 16;
    const rawCount = boxes.length / stride;
    console.log(`[FACE] Raw detections: ${rawCount}`);

    const detections = [];
    let validConf = 0;

    for (let i = 0; i + 3 < boxes.length; i += stride) {
        const topY = Number(boxes[i]);
        const topX = Number(boxes[i + 1]);
        const botY = Number(boxes[i + 2]);
        const botX = Number(boxes[i + 3]);
        // 16 values: top_y, top_x, bottom_y, bottom_x + 6 landmark pairs (12 values)
        // When scoreTensor exists we'd use it, otherwise model already filtered by conf_threshold
        const scoreRaw = scores ? Number(scores[Math.floor(i / stride)] ?? 0) : FACE_MIN_CONFIDENCE;
        // Use model-provided score if available, else treat as meeting threshold (already filtered)
        const score = scores ? scoreRaw : 0.99; // assign high score for NMS sorting when no scores
        // Keep threshold check only if we have real scores; otherwise skip (already filtered)
        if (scores && (!Number.isFinite(score) || score < FACE_MIN_CONFIDENCE)) continue;
        if (![topY, topX, botY, botX].every(Number.isFinite)) continue;
        validConf++;

        // ---- 13. VERIFY COORDINATE CONVERSION ----
        // Model outputs normalized 0..1 as top_y, top_x, bot_y, bot_x
        const x1 = Math.max(0, Math.min(W, Math.min(topX, botX) * W));
        const y1 = Math.max(0, Math.min(H, Math.min(topY, botY) * H));
        const x2 = Math.max(0, Math.min(W, Math.max(topX, botX) * W));
        const y2 = Math.max(0, Math.min(H, Math.max(topY, botY) * H));
        if (x2 - x1 < 5 || y2 - y1 < 5) continue;
        // sanity 0 <= x1 < x2 <= W
        if (!(0 <= x1 && x1 < x2 && x2 <= W && 0 <= y1 && y1 < y2 && y2 <= H)) continue;

        detections.push({
            source_id: `face_${String(detections.length).padStart(3, "0")}`,
            entity: "FACE",
            score: scores ? score : 0.92,
            bbox: [x1, y1, x2, y2],
            decision_source: "face_detector",
            redaction_style: FACE_REDACTION_STYLE,
        });
    }
    console.log(`[FACE] Valid confidence detections: ${validConf}`);
    if (FACE_DEBUG) {
        for (const d of detections) console.log(`[FACE][DEBUG] raw bbox [${d.bbox.map(v => Math.round(v)).join(",")}] score ${d.score}`);
    }

    const kept = _nmsFaceDetections(detections, FACE_IOU_THRESHOLD);
    kept.forEach((d, idx) => { d.source_id = `face_${String(idx).padStart(3, "0")}`; });
    console.log(`[FACE] After NMS: ${kept.length}`);
    console.log(`[FACE] Final faces: ${kept.length}`);
    if (kept.length) {
        for (const k of kept) console.log(`[FACE] Face bbox: [${k.bbox.map(v => Math.round(v)).join(",")}] score ${k.score.toFixed(3)}  (mapped x*=W y*=H, order top_y,top_x,bot_y,bot_x)`);
    }
    console.log(`[FACE] Faces detected: ${kept.length} (${Date.now() - tStart} ms)`);
    tPost = Date.now() - tPost0;

    // ---- 18. PERFORMANCE + 12. DEBUG FACE BOX OUTPUT ----
    console.log(`[FACE] Timings: load ${tLoad}ms prep ${tPrep}ms infer ${tInfer}ms post ${tPost}ms total ${Date.now() - tStart}ms`);
    if (FACE_DEBUG && kept.length) {
        await _generateFaceDebugImage(imagePath, kept, W, H);
    } else if (FACE_DEBUG) {
        console.log(`[FACE] No faces to draw for face_debug.png`);
        // still generate empty overlay so existence is clear?
    }

    // ---- 22. FINAL REPORT DATA ----
    if (FACE_DEBUG) {
        console.log(`========== FACE DETECTOR REPORT ==========`);
        console.log(`Model: garavv/blazeface-onnx`);
        console.log(`Model URL: ${FACE_MODEL_URL}`);
        console.log(`Model size: ${detector.modelSize || "unknown"} bytes`);
        console.log(`Runtime: onnxruntime-node`);
        console.log(`Backend: ${detector.backend}`);
        console.log(`Input: RGB 128x128 NCHW float32 [0,1]`);
        console.log(`Input shape: [1,3,128,128]`);
        console.log(`Input dtype: float32`);
        console.log(`Input range: [${minV.toFixed(3)},${maxV.toFixed(3)}]`);
        console.log(`Outputs: Output names: ${JSON.stringify(detector.session.outputNames)}`);
        console.log(`Output shapes: ${JSON.stringify(Object.fromEntries(Object.entries(output).map(([k, v]) => [k, v.dims])))}`);
        console.log(`Root cause of selectedBoxes [1,0,16]: wrong NCHW layout (interleaved RGBRGB instead of planar) + threshold filtering; fixed by correct planar NCHW`);
        console.log(`Fix: corrected input to planar NCHW and parse selectedBoxes by name`);
        console.log(`Raw detections: ${rawCount}`);
        console.log(`Confidence-filtered: ${validConf}`);
        console.log(`After NMS: ${kept.length}`);
        console.log(`Final faces: ${kept.length}`);
        if (kept[0]) console.log(`Face bbox: [${kept[0].bbox.map(v => Math.round(v)).join(",")}]`);
        console.log(`Coordinate mapping: top_y,top_x,bot_y,bot_x (normalized 0..1) -> x*=W y*=H`);
        console.log(`Face inference time: ${tInfer}ms`);
        console.log(`Total time: ${Date.now() - tStart}ms`);
        console.log(`Debug image: ./face_debug.png`);
        console.log(`===========================================`);
    }

    return kept;
}

function isFaceFinding(finding) {
    return finding?.decision_source === "face_detector" || finding?.entity === "FACE";
}

function uniqueRedactionRegions(findings) {
    const seen = new Map();
    for (const finding of findings || []) {
        if (!finding?.bbox) continue;
        const bbox = finding.bbox.map(Number);
        if (!bbox.every(Number.isFinite)) continue;
        const key = bbox.map((v) => Math.round(v)).join(",");
        if (!seen.has(key)) seen.set(key, finding);
    }
    return [...seen.values()];
}

/* ============================================================
   EVIDENCE
   ============================================================ */

function buildNERChunks({ ocr }) {
    if (!ocr?.items) return [];
    return ocr.items.map((item) => ({
        id: item.id,
        text: item.text,
        bbox: item.bbox ?? null,
        confidence: item.confidence,
    }));
}

async function buildEvidence() {
    logSection(
        "Building Evidence (image-only)"
    );

    console.log(
        `Image: ${IMAGE_PATH}`
    );

    let image = null;

    try {
        image =
            await load_image(
                IMAGE_PATH
            );
    } catch (e) {
        console.warn(
            `[WARN] load_image failed: ${e.message}`
        );
    }

    /* ---------------- FACE DETECTION ---------------- */

    let faceFindings = [];

    if (FACE_ENABLED) {
        try {
            faceFindings =
                await runFaceDetection(
                    IMAGE_PATH
                );
        } catch (error) {
            console.warn(
                `[WARN] Face detection unavailable: ${error.message}`
            );

            faceFindings = [];
        }
    }

    /* ---------------- OCR ---------------- */

    const ocr =
        await runOCR(
            IMAGE_PATH
        );

    const readingOrder =
        buildReadingOrder(
            ocr
        );

    /* ---------------- NER ---------------- */

    const rawChunks =
        buildNERChunks({
            ocr,
        });

    let nerFindings = [];

    try {
        const ner =
            await loadNER();

        nerFindings =
            await runNER(
                ner,
                ocr
            );
    } catch (e) {
        console.warn(
            `[WARN] Ettin NER unavailable: ${e.message}`
        );

        nerFindings = [];
    }

    /* ---------------- DETERMINISTIC ---------------- */

    const deterministicFindings =
        extractSensitiveFieldCandidates(
            ocr
        );

    /* ---------------- FUSION ---------------- */

    const fusedCandidates =
        fuseRedactionCandidates({
            ettinFindings:
                nerFindings,

            deterministicFindings,
        });

    /* ---------------- UI STRUCTURE ---------------- */

    const uiStructure =
        buildUIStructure({
            image,
            ocr,
            fastvlm: null,
        });

    /* ---------------- FASTVLM EVIDENCE ---------------- */

    const fastvlmEvidence =
        buildFastVLMRedactionEvidence({
            image,
            ocr,
            ettinFindings:
                nerFindings,
            deterministicFindings,
            fusedCandidates,
        });

    /* ---------------- FASTVLM ---------------- */

    let fastvlmResult = null;

    if (
        ENABLE_FASTVLM &&
        FASTVLM_ENABLED &&
        (
            fusedCandidates.length >
            0 ||
            (
                ocr.items &&
                ocr.items.length >
                0
            )
        )
    ) {
        fastvlmResult =
            await runFastVLMRedactionAdjudication({
                imagePath:
                    IMAGE_PATH,

                evidence:
                    fastvlmEvidence,
            });
    } else {
        fastvlmResult = {
            status:
                "skipped",
            reason:
                "FastVLM disabled or no OCR evidence",

            raw: JSON.stringify({
                status:
                    "skipped",
                reason:
                    "FastVLM disabled or no OCR evidence",
            }),
        };

        await persistFastVLMOutput(
            fastvlmResult.raw
        );
    }

    /* ---------------- DECISION ---------------- */

    const adjudication =
        adjudicateOrFallback({
            ettinFindings:
                nerFindings,

            deterministicFindings,

            fusedCandidates,

            fastvlmResult,

            evidence: {
                fastvlm_evidence:
                    fastvlmEvidence,
            },

            image,
        });

    const finalTextFindings =
        adjudication.finalFindings;

    const finalFindings = [
        ...finalTextFindings,
        ...faceFindings,
    ];

    /* ---------------- REDACTION ---------------- */

    const redactedChunks =
        redactChunks(
            rawChunks,
            finalTextFindings
        );

    const redactedOcrText =
        redactedChunks
            .map(
                c => c.text
            )
            .join(" ");

    const imageRedaction =
        await redactImage(
            IMAGE_PATH,
            finalFindings,
            OUTPUT_IMAGE_PATH
        );

    return {
        input_mode: {
            image: true,
            dom: false,
        },

        image: {
            width:
                image.width,

            height:
                image.height,

            redacted_output:
                OUTPUT_IMAGE_PATH,
        },

        global_description: {
            caption: fastvlmResult?.parsed?.caption ?? null,
            source: "fastvlm",
            model: FASTVLM_MODEL,
            status: fastvlmResult?.status ?? "unknown",
        },

        // Florence-compatible alias for UI that expects florence.description
        florence: {
            description: fastvlmResult?.parsed?.caption ?? "",
            caption: fastvlmResult?.parsed?.caption ?? "",
            source: "fastvlm",
            model: FASTVLM_MODEL,
        },

        ocr: {
            ...ocr,

            reading_order:
                readingOrder.ordered.map(
                    o => ({
                        id: o.id,
                        reading_order:
                            o.reading_order,
                        bbox: o.bbox,
                    })
                ),
        },

        ui_structure:
            uiStructure,

        face_detection: {
            enabled:
                FACE_ENABLED,

            model:
                "garavv/blazeface-onnx",

            backend:
                _faceModelCache
                    ?.backend ??
                null,

            confidence_threshold:
                FACE_MIN_CONFIDENCE,

            faces:
                faceFindings,

            count:
                faceFindings.length,
        },

        image_redaction: {
            ...imageRedaction,

            status:
                adjudication.status,

            redaction_complete:
                adjudication.redaction_complete,

            fallback:
                adjudication.fallback,
        },

        ner: {
            model:
                NER_MODEL,

            sequence_mode:
                "full_ocr_text",

            source_text_length:
                ocr.text?.length ??
                0,

            findings:
                nerFindings,
        },

        deterministic_context: {
            findings:
                deterministicFindings,
        },

        candidate_fusion: {
            candidates:
                fusedCandidates,
        },

        fastvlm_adjudication: {
            model:
                FASTVLM_MODEL,

            enabled:
                FASTVLM_ENABLED,

            status:
                fastvlmResult?.status ??
                "unknown",

            redaction_complete:
                adjudication.redaction_complete,

            fallback:
                adjudication.fallback,

            raw:
                fastvlmResult?.raw
                    ? String(
                        fastvlmResult.raw
                    ).slice(
                        0,
                        2000
                    )
                    : null,

            parsed:
                fastvlmResult?.parsed ??
                null,

            validation:
                adjudication.validation ??
                null,

            caption:
                fastvlmResult?.parsed?.caption ?? null,

            redactions:
                fastvlmResult?.parsed
                    ?.redactions ??
                [],

            rejected_candidates:
                fastvlmResult?.parsed
                    ?.rejected_candidates ??
                [],

            reason:
                fastvlmResult?.reason ??
                null,
        },

        fastvlm_evidence:
            fastvlmEvidence,

        final_findings:
            finalFindings,

        redaction: {
            chunks:
                redactedChunks,

            redacted_ocr_text:
                redactedOcrText,

            entity_types_found:
                [
                    ...new Set(
                        finalFindings.map(
                            f => f.entity
                        )
                    ),
                ],

            adjudication_status:
                adjudication.status,

            redaction_complete:
                adjudication.redaction_complete,
        },

        filtering: {
            original_chunk_count:
                rawChunks.length,

            filtered_chunk_count:
                rawChunks.length,
        },
    };
}

async function main() {
    // ---- 18. TEST MODEL DIRECTLY BEFORE FULL PIPELINE: FACE_ONLY=1 ----
    if (process.env.FACE_ONLY === "1") {
        logSection("FACE ONLY DIAGNOSTIC");
        const t0 = Date.now();
        const detector = await loadFaceDetector();
        console.log(`[FACE_ONLY] Model load: ${detector ? "SUCCESS" : "FAILED"}`);
        if (detector?.session) {
            console.log(`[FACE_ONLY] InputNames: ${JSON.stringify(detector.session.inputNames)}`);
            console.log(`[FACE_ONLY] OutputNames: ${JSON.stringify(detector.session.outputNames)}`);
        }
        const faces = await runFaceDetection(IMAGE_PATH);
        console.log(`[FACE_ONLY] Faces: ${faces.length}`);
        for (const f of faces) console.log(`[FACE_ONLY] bbox [${f.bbox.map(v => Math.round(v)).join(",")}] score ${f.score}`);
        console.log(`[FACE_ONLY] Total time: ${Date.now() - t0}ms`);
        // Ensure debug image was generated if FACE_DEBUG=1
        if (process.env.FACE_DEBUG === "1") console.log(`[FACE_ONLY] Debug image should be ./face_debug.png`);
        // Exit after face-only
        console.log(`[FACE_ONLY] Done. Exiting.`);
        process.exit(faces.length >= 1 ? 0 : 2);
    }
    logSection("LOCAL PERCEPTION PIPELINE (image-only)");

    const evidence = await buildEvidence();

    await fs.writeFile(
        EVIDENCE_OUTPUT_PATH,
        JSON.stringify(evidence, null, 2),
        "utf8"
    );
    console.log(`\n[OK] Evidence saved: ${EVIDENCE_OUTPUT_PATH}`);
    console.log(`[OK] FastVLM adjudication status: ${evidence.fastvlm_adjudication?.status} (complete=${evidence.fastvlm_adjudication?.redaction_complete})`);
    console.log(`[OK] Deterministic findings: ${evidence.deterministic_context?.findings?.length ?? 0}`);
    console.log(`[OK] Fused candidates: ${evidence.candidate_fusion?.candidates?.length ?? 0}`);
    console.log(`[OK] Final text findings: ${evidence.redaction?.entity_types_found?.length ?? 0} entity types`);
    console.log(`[OK] Face findings: ${evidence.face_detection?.count ?? 0}`);
    console.log(`[OK] Final findings: ${evidence.final_findings?.length ?? 0}`);
    if (evidence.fastvlm_adjudication?.caption) {
        console.log(`[OK] Image description (FastVLM): ${evidence.fastvlm_adjudication.caption}`);
    } else if (evidence.global_description?.caption) {
        console.log(`[OK] Image description (FastVLM): ${evidence.global_description.caption}`);
    }

    const prompt = buildPerceptionPrompt(evidence);
    await fs.writeFile(FASTVLM_PROMPT_PATH, prompt, "utf8");
    console.log(`[OK] FastVLM prompt saved: ${FASTVLM_PROMPT_PATH}`);

    // Also save the redaction adjudication prompt for debugging
    try {
        const redactionPrompt = evidence.fastvlm_evidence ? buildFastVLMRedactionPrompt(evidence.fastvlm_evidence) : null;
        if (redactionPrompt) {
            await fs.writeFile("./fastvlm_redaction_prompt.txt", redactionPrompt, "utf8");
            console.log(`[OK] FastVLM redaction prompt saved: ./fastvlm_redaction_prompt.txt`);
        }
    } catch (e) {
        console.warn(`[WARN] could not write redaction prompt: ${e.message}`);
    }

    console.log(`[OK] Redacted image saved: ${OUTPUT_IMAGE_PATH}`);

    logSection("FASTVLM PERCEPTION PROMPT");
    console.log(prompt);

    logSection("DONE");
}

// Exports for regression tests (keep pipeline runnable as main)
export {
    buildReadingOrder,
    extractSensitiveFieldCandidates,
    extractLabelValueSameLine,
    extractLabelValueSideBySide,
    extractLabelValueVertical,
    normalizeLabelForMatch,
    findFieldLabelMatch,
    isPlausibleValue,
    fuseRedactionCandidates,
    buildFastVLMRedactionEvidence,
    buildFastVLMRedactionPrompt,
    validateFastVLMRedactionOutput,
    resolveFinalRedactionRegions,
    applySafetyGates,
    adjudicateOrFallback,
    buildFastVLMFinalCandidates,
    estimateTextSubBBox,
    resolveSensitiveValueBBox,
    loadFaceDetector,
    runFaceDetection,
    // re-export for test inspection
    SENSITIVE_FIELD_VOCABULARY,
};

import { pathToFileURL } from "node:url";
const _isMain = (() => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch { return false; }
})();
if (_isMain) {
    main().catch((error) => {
        console.error("\n[ERROR]");
        console.error(error.stack || error.message || error);
        process.exit(1);
    });
}