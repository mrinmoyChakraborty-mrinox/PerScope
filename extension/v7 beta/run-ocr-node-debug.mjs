import fs from "node:fs";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";
const buf = await fs.promises.readFile("D:\\perscope\\s4.png");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
const service = new PaddleOcrService({ model: V6_SMALL_MODEL, recognition: { strategy: "per-line", minimumConfidence: 0.5 }});
await service.initialize();
console.log("[HARNESS-NODE] PaddleOCR Node (opencv) initialized");
const result = await service.recognize(ab, { flatten: true });
console.log(`[OCR-DEBUG] result.results count=${(result.results||[]).length} text.length=${(result.text||"").length} confidence=${result.confidence}`);
console.log(`[OCR-DEBUG] full text: '${result.text}'`);
for(const r of (result.results||[])){
  const b=r.box||{};
  console.log(`[OCR-DEBUG] bbox=[x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}] text='${r.text}' conf=${Number(r.confidence??0).toFixed(3)} raw=${JSON.stringify(r)}`);
}
