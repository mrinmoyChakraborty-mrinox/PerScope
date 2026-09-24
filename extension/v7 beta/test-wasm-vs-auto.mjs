import fs from "node:fs";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";

// Force wasm backend explicitly like the edit does for extension
const buf = await fs.promises.readFile("D:/perscope/s4.png");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);

console.log("=== WASM FORCED (extension-style) ===");
const svcWasm = new PaddleOcrService({
  model: V6_SMALL_MODEL,
  recognition: { strategy: "per-line", minimumConfidence: 0.5 },
  session: { executionProviders: ["wasm"] },
});
await svcWasm.initialize();
console.log("[WASM] initialized");
const resWasm = await svcWasm.recognize(ab, { flatten: true });
console.log(`[OCR-DEBUG] WASM count=${resWasm.results.length} text='${resWasm.text}'`);
for(const r of resWasm.results){
  console.log(`[OCR-DEBUG] bbox=[x=${r.box.x}, y=${r.box.y}, w=${r.box.width}, h=${r.box.height}] text='${r.text}' conf=${r.confidence.toFixed(3)}`);
}

console.log("\n=== DEFAULT (auto) ===");
const svcAuto = new PaddleOcrService({
  model: V6_SMALL_MODEL,
  recognition: { strategy: "per-line", minimumConfidence: 0.5 },
});
await svcAuto.initialize();
console.log("[AUTO] initialized");
const resAuto = await svcAuto.recognize(ab, { flatten: true });
console.log(`[OCR-DEBUG] AUTO count=${resAuto.results.length} text='${resAuto.text}'`);
for(const r of resAuto.results){
  console.log(`[OCR-DEBUG] bbox=[x=${r.box.x}, y=${r.box.y}, w=${r.box.width}, h=${r.box.height}] text='${r.text}' conf=${r.confidence.toFixed(3)}`);
}
