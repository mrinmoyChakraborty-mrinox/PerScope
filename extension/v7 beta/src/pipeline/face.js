/**
 * BlazeFace ONNX Face Detection - Browser / WebGPU / WASM
 * Preprocesses image via OffscreenCanvas to planar NCHW [1, 3, 128, 128] RGB [0, 1]
 */
import * as Ort from "onnxruntime-web";

const FACE_MODEL_URL = "https://huggingface.co/garavv/blazeface-onnx/resolve/main/blaze.onnx";
const FACE_DEFAULT_MIN_CONF = 0.60;
const FACE_DEFAULT_IOU = 0.30;
const FACE_DEFAULT_MAX_DETECTIONS = 25;

let _faceSessionCache = null;
let _faceSessionPromise = null;

export function _iou(a, b) {
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

export function _nmsFaceDetections(detections, iouThreshold = FACE_DEFAULT_IOU, maxDetections = FACE_DEFAULT_MAX_DETECTIONS) {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const det of sorted) {
    if (kept.some((k) => _iou(k.bbox, det.bbox) > iouThreshold)) continue;
    kept.push(det);
    if (kept.length >= maxDetections) break;
  }
  return kept;
}

export async function resolveFaceModelUrl() {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    const local = chrome.runtime.getURL("models/blazeface/blaze.onnx");
    try {
      const head = await fetch(local, { method: "HEAD" });
      if (head.ok) return local;
    } catch {}
  }
  return FACE_MODEL_URL;
}

export async function loadFaceDetector(options = {}) {
  if (_faceSessionCache) return _faceSessionCache;
  if (_faceSessionPromise) return await _faceSessionPromise;

  _faceSessionPromise = (async () => {
    const t0 = performance.now();
    const modelUrl = await resolveFaceModelUrl();
    console.log(`[FACE] Loading BlazeFace model from: ${modelUrl}`);

    // Fast and stable on wasm/cpu; option to pass webgpu
    const executionProviders = options.useWebGpu ? ["webgpu", "wasm"] : ["wasm", "cpu"];
    const session = await Ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: "all",
    });

    _faceSessionCache = {
      session,
      modelUrl,
      backend: executionProviders[0] || "wasm",
      loadMs: performance.now() - t0,
    };
    console.log(`[FACE] BlazeFace detector loaded in ${_faceSessionCache.loadMs.toFixed(1)}ms (${_faceSessionCache.backend})`);
    return _faceSessionCache;
  })();

  try {
    return await _faceSessionPromise;
  } finally {
    _faceSessionPromise = null;
  }
}

/**
 * Runs face detection on an ImageBitmap or Canvas
 */
export async function runFaceDetection(imageBitmapOrCanvas, options = {}) {
  const minConfidence = options.minConfidence ?? FACE_DEFAULT_MIN_CONF;
  const iouThreshold = options.iouThreshold ?? FACE_DEFAULT_IOU;
  const maxDetections = options.maxDetections ?? FACE_DEFAULT_MAX_DETECTIONS;
  const redactionStyle = options.redactionStyle || "blur";

  const detector = await loadFaceDetector(options);
  if (!detector?.session) return [];

  const W = Number(imageBitmapOrCanvas.width || 0);
  const H = Number(imageBitmapOrCanvas.height || 0);
  if (!W || !H) throw new Error("Invalid image dimensions for face detection");

  // Resize to 128x128 using OffscreenCanvas
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageBitmapOrCanvas, 0, 0, 128, 128);
  const imgData = ctx.getImageData(0, 0, 128, 128).data;

  // Planar NCHW [1, 3, 128, 128] float32 [0, 1] RGB
  const input = new Float32Array(1 * 3 * 128 * 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const idx = (y * 128 + x) * 4;
      const r = imgData[idx] / 255.0;
      const g = imgData[idx + 1] / 255.0;
      const b = imgData[idx + 2] / 255.0;
      input[0 * 128 * 128 + y * 128 + x] = r;
      input[1 * 128 * 128 + y * 128 + x] = g;
      input[2 * 128 * 128 + y * 128 + x] = b;
    }
  }

  const feeds = {
    image: new Ort.Tensor("float32", input, [1, 3, 128, 128]),
    conf_threshold: new Ort.Tensor("float32", new Float32Array([minConfidence]), [1]),
    max_detections: new Ort.Tensor("int64", BigInt64Array.from([BigInt(maxDetections)]), [1]),
    iou_threshold: new Ort.Tensor("float32", new Float32Array([iouThreshold]), [1]),
  };

  const output = await detector.session.run(feeds);
  const boxTensor = output.selectedBoxes ?? output["selectedBoxes"] ?? Object.values(output)[0];
  const scoreTensor = output.selectedScores ?? output["selectedScores"] ?? null;

  if (!boxTensor) {
    console.warn("[FACE] No selectedBoxes found in model outputs.");
    return [];
  }

  const boxes = Array.from(boxTensor.data || []);
  const scores = scoreTensor ? Array.from(scoreTensor.data || []) : null;
  const stride = 16;
  const detections = [];

  for (let i = 0; i + 3 < boxes.length; i += stride) {
    const topY = Number(boxes[i]);
    const topX = Number(boxes[i + 1]);
    const botY = Number(boxes[i + 2]);
    const botX = Number(boxes[i + 3]);

    const scoreRaw = scores ? Number(scores[Math.floor(i / stride)] ?? 0) : minConfidence;
    const score = scores ? scoreRaw : 0.95;

    if (scores && (!Number.isFinite(score) || score < minConfidence)) continue;
    if (![topY, topX, botY, botX].every(Number.isFinite)) continue;

    const x1 = Math.max(0, Math.min(W, Math.min(topX, botX) * W));
    const y1 = Math.max(0, Math.min(H, Math.min(topY, botY) * H));
    const x2 = Math.max(0, Math.min(W, Math.max(topX, botX) * W));
    const y2 = Math.max(0, Math.min(H, Math.max(topY, botY) * H));

    if (x2 - x1 < 5 || y2 - y1 < 5) continue;
    if (!(0 <= x1 && x1 < x2 && x2 <= W && 0 <= y1 && y1 < y2 && y2 <= H)) continue;

    detections.push({
      source_id: `face_${String(detections.length).padStart(3, "0")}`,
      entity: "FACE",
      score: scores ? score : 0.92,
      bbox: [x1, y1, x2, y2],
      decision_source: "face_detector",
      redaction_style: redactionStyle,
    });
  }

  const kept = _nmsFaceDetections(detections, iouThreshold, maxDetections);
  kept.forEach((d, idx) => {
    d.source_id = `face_${String(idx).padStart(3, "0")}`;
  });

  console.log(`[FACE] Detected ${kept.length} face(s) in image (${W}x${H})`);
  return kept;
}
