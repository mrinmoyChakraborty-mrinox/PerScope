import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mock chrome.runtime.getURL to return file URLs that fetch can read via http://localhost fallback?
// For this harness, patch loadOCRService to use V6_SMALL_MODEL directly with wasm session,
// bypassing chrome fetch, but still exercising the exact code path we just added.

// Mock globals for extension code
globalThis.chrome = {
  runtime: {
    getURL: (p) => {
      // Return a model URL that will HEAD-fail and fallback to V6_SMALL_MODEL unless we mock fetch
      // We'll mock fetch to succeed for our local models
      const full = path.resolve("D:/perscope/dist", p);
      return `file://${full}`;
    }
  }
};

// Mock OffscreenCanvas / createImageBitmap minimally for onnxruntime-web wasm path
// onnxruntime-web in Node will use wasm anyway; PaddleOCR web expects canvas via ppu-ocv/canvas-web
// which in Node with wasm still needs canvas. We'll provide a simple polyfill using @napi-rs/canvas.
import { Canvas, loadImage } from "@napi-rs/canvas";

globalThis.OffscreenCanvas = class {
  constructor(w,h){
    this.width=w; this.height=h;
    this._canvas = new Canvas(w,h);
  }
  getContext(type, opts){ return this._canvas.getContext(type); }
  convertToBlob(opts){
    const buf = this._canvas.toBuffer("image/png");
    return Promise.resolve(new Blob([buf], {type:"image/png"}));
  }
};

globalThis.createImageBitmap = async (blob) => {
  const ab = await blob.arrayBuffer();
  const img = await loadImage(Buffer.from(ab));
  // Return a canvas-like object that ppu-ocv can draw
  const c = new Canvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  // ppu-ocv expects either canvas or ImageBitmap with width/height and getContext
  c.width = img.width; c.height = img.height;
  return c;
};

// Mock fetch to handle file:// and chrome URLs for model loading
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (url.startsWith("file://")) {
    const p = url.slice(7);
    if (opts && opts.method === "HEAD") {
      try { await fs.promises.access(p); return { ok: true, status: 200 }; } catch { return { ok: false, status: 404 }; }
    }
    const data = await fs.promises.readFile(p);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength),
      blob: async () => new Blob([data]),
      text: async () => data.toString("utf-8"),
      headers: new Map(),
    };
  }
  // For http model URLs (huggingface), fallback to original fetch
  return origFetch(url, opts);
};

console.log("[HARNESS] Mocks installed, importing v7-extension.js...");

// Import after mocks
const mod = await import("file:///D:/perscope/src/pipeline/v7-extension.js");
console.log("[HARNESS] Imported, running runExtensionPipeline on s4.png...");

const buf = await fs.promises.readFile("D:/perscope/s4.png");
// Need to provide ArrayBuffer
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);

let lastLogs = [];
const origLog = console.log;
const origWarn = console.warn;
// Capture logs but also print

const result = await mod.runExtensionPipeline(ab, { fastvlmEnabled: false, faceEnabled: true }, (progress) => {
  console.log(`[PROGRESS] ${progress.stage} ${progress.status} ${JSON.stringify(Object.fromEntries(Object.entries(progress).filter(([k])=>!["stage","status"].includes(k))))}`);
});

console.log("\n========== PIPELINE DONE ==========");
console.log(`Total time: ${result.totalTimeMs}ms`);
console.log(`OCR items: ${result.evidence.ocr.items.length}`);
console.log(`OCR text: '${result.evidence.ocr.text}'`);
console.log(`NER findings: ${result.evidence.ner.findings.length}`);
for (const f of result.evidence.ner.findings) {
  console.log(`[NER-RESULT] entity=${f.entity} text='${f.text}' score=${Number(f.score).toFixed(3)} source=${f.source_id}`);
}
console.log(`Final findings: ${result.evidence.final_findings.length}`);

