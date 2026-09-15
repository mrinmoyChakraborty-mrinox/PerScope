import fs from "node:fs";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";
const buf = await fs.promises.readFile("D:/perscope/s4.png");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
console.log("=== CPU ===");
const svc = new PaddleOcrService({
  model: V6_SMALL_MODEL,
  recognition: { strategy: "per-line", minimumConfidence: 0.5 },
  session: { executionProviders: ["cpu"] },
});
await svc.initialize();
console.log("[CPU] initialized");
const res = await svc.recognize(ab, { flatten: true });
console.log(`[OCR-DEBUG] CPU count=${res.results.length}`);
for(const r of res.results) console.log(`[OCR-DEBUG] ${r.box.x},${r.box.y},${r.box.width},${r.box.height} '${r.text}' ${r.confidence.toFixed(3)}`);
