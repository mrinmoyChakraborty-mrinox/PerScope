import fs from "node:fs";
import { createRequire } from "node:module";

// Mock chrome.runtime.getURL
globalThis.chrome = {
  runtime: {
    getURL: (p) => {
      // Return file URL for local model check — fetch will use file read fallback via http?
      // For v7-extension loadOCRService, it does fetch(localDetection, {method:"HEAD"})
      // In Node fetch will try http, so will fail and fallback to V6_SMALL_MODEL.
      // We want to force packaged models else — set to not exist so it uses V6_SMALL_MODEL which is fine.
      return `http://localhost:0/${p}`;
    }
  }
};

// Mock OffscreenCanvas and createImageBitmap for Node
import { Canvas, loadImage } from "@napi-rs/canvas";
globalThis.OffscreenCanvas = class OffscreenCanvas {
  constructor(w,h){ this.canvas = new Canvas(w,h); this.width=w; this.height=h; }
  getContext(t){ return this.canvas.getContext(t); }
  convertToBlob(opts){ return this.canvas.toBuffer("image/png").then ? Promise.resolve(new Blob([this.canvas.toBuffer("image/png")])) : new Blob([this.canvas.toBuffer("image/png")]); }
};
globalThis.createImageBitmap = async (blob) => {
  const ab = await blob.arrayBuffer();
  const img = await loadImage(Buffer.from(ab));
  return { width: img.width, height: img.height, close(){}, drawImage(){ } };
};
// Mock Blob if needed (Node has Blob)
globalThis.ImageData = class ImageData {};

console.log("Harness mocks installed");

// Now import pipeline and run OCR only via direct PaddleOcrService web
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";
import fs2 from "node:fs";

const buf = await fs2.promises.readFile("s4.png");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
console.log(`Image buffer ${ab.byteLength} bytes`);

const service = new PaddleOcrService({ model: V6_SMALL_MODEL, recognition: { strategy: "per-line", minimumConfidence: 0.5 }});
await service.initialize();
console.log("[HARNESS] PaddleOCR web initialized");

const result = await service.recognize(ab, { flatten: true });
console.log(`[OCR-DEBUG] result.results count=${(result.results||[]).length} text.length=${(result.text||"").length}`);
console.log(`[OCR-DEBUG] full text: '${result.text}'`);
for(const r of (result.results||[])){
  const b=r.box||{};
  console.log(`[OCR-DEBUG] bbox=[x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}] text='${r.text}' conf=${Number(r.confidence??0).toFixed(3)}`);
}
console.log(JSON.stringify(result,null,2));
