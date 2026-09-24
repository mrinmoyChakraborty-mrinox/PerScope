// Downloads the FastVLM-0.5B weight files from HuggingFace into the local
// transformers.js FileCache layout that build.mjs packages for full-offline
// builds (INCLUDE_BIG_MODELS=1 -> dist/models/onnx-community/...).
//
// Usage:
//   node scripts/download-fastvlm-q4f16.mjs              (q4f16 variant)
//   VARIANT=q4 node scripts/download-fastvlm-q4f16.mjs   (plain q4 variant)
// Must match FASTVLM_DTYPE in v7.mjs / src/pipeline/v7-extension.js.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const REPO = "onnx-community/FastVLM-0.5B-ONNX";
const DEST = resolve(
  import.meta.dirname,
  "../node_modules/@huggingface/transformers/.cache",
  REPO,
);

// Exact byte sizes from the HF repo tree (used to skip complete files).
// Weight pair follows VARIANT (default q4f16); embed_tokens stays fp16.
const VARIANT = (process.env.VARIANT || "q4f16").trim();
const WEIGHTS =
  VARIANT === "q4"
    ? [
        { path: "onnx/vision_encoder_q4.onnx", size: 505205898 },
        { path: "onnx/decoder_model_merged_q4.onnx", size: 317445767 },
      ]
    : [
        { path: "onnx/vision_encoder_q4f16.onnx", size: 252699057 },
        { path: "onnx/decoder_model_merged_q4f16.onnx", size: 282252137 },
      ];
const FILES = [
  { path: "config.json", size: 1328 },
  { path: "generation_config.json", size: 121 },
  { path: "preprocessor_config.json", size: 466 },
  { path: "processor_config.json", size: 133 },
  { path: "special_tokens_map.json", size: 367 },
  { path: "added_tokens.json", size: 80 },
  { path: "tokenizer_config.json", size: 1529 },
  { path: "vocab.json", size: 2776833 },
  { path: "merges.txt", size: 1670344 },
  { path: "tokenizer.json", size: 11413284 },
  { path: "onnx/embed_tokens_fp16.onnx", size: 271810890 },
  ...WEIGHTS,
];

async function downloadOne({ path, size }) {
  const dest = resolve(DEST, path);
  if (existsSync(dest)) {
    try {
      if (statSync(dest).size === size) {
        console.log(`[SKIP] ${path} (already complete, ${(size / 1048576).toFixed(1)} MB)`);
        return;
      }
      console.log(`[REDO] ${path} exists but size mismatch, re-downloading...`);
      rmSync(dest, { force: true });
    } catch {}
  }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${REPO}/resolve/main/${path}`;
  const tmp = `${dest}.tmp.${process.pid}`;
  console.log(`[GET ] ${path} (${(size / 1048576).toFixed(1)} MB)`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${path}`);
  const total = Number(res.headers.get("content-length") || size);
  const out = createWriteStream(tmp);
  const reader = Readable.fromWeb(res.body);
  let done = 0;
  let lastLog = Date.now();
  reader.on("data", (chunk) => {
    done += chunk.length;
    const now = Date.now();
    if (now - lastLog > 10000) {
      lastLog = now;
      console.log(`  ... ${path}: ${(done / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB`);
    }
  });
  await finished(reader.pipe(out));
  const got = statSync(tmp).size;
  if (got !== size) {
    rmSync(tmp, { force: true });
    throw new Error(`Size mismatch for ${path}: got ${got}, expected ${size}`);
  }
  renameSync(tmp, dest);
  console.log(`[DONE] ${path}`);
}

for (const f of FILES) {
  await downloadOne(f);
}
console.log("\nAll FastVLM q4f16 files present in:", DEST);
