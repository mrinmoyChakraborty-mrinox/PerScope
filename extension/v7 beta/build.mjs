import * as esbuild from "esbuild";
import { rmSync, mkdirSync, copyFileSync, cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname);
const dist = resolve(root, "dist");
const src = resolve(root, "src");

// P0 version marker: every bundle stamps its origin so a console line or
// evidence blob always answers "which code ran" (ended the stale-build vs
// new-bug confusion 2026-09-28). No source edits needed — esbuild footer.
let buildCommit = "unknown";
try {
  buildCommit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim() || "unknown";
} catch {}
const buildStamp = `;globalThis.__PERSCOPE_BUILD=${JSON.stringify({ commit: buildCommit, time: new Date().toISOString() })};`;
console.log(`[BUILD] marker: ${buildStamp.slice(0, 120)}`);

console.log("[BUILD] Cleaning dist directory...");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Bundle JavaScript entry points for browser
const entries = [
  { in: resolve(src, "popup/popup.js"), out: "popup.js" },
  { in: resolve(src, "approval/approval.js"), out: "approval.js" },
  { in: resolve(src, "background/service-worker.js"), out: "background.js" },
  { in: resolve(src, "offscreen/offscreen.js"), out: "offscreen.js" },
  { in: resolve(src, "app/dashboard.js"), out: "dashboard.js" },
  // DOM snapshot capture content script (runs in every frame via
  // content_scripts all_frames). Bundled with the same browser-target
  // pattern as offscreen.js. NOTE: it statically imports Koyel's
  // piidetector.js Tier0 (detectPII/redactPII, unmodified); piidetector's
  // Node CLI branch requires "readline", which is dead in this context
  // (require.main is unset in the bundle, so the lazy __require call never
  // fires) — hence "readline" is external rather than bundled.
  // NOTE 2: "@huggingface/transformers" is external ONLY for this entry.
  // piidetector's loadNER() dynamically imports it, but the content script
  // runs Tier0 only and never calls loadNER. Without this, esbuild inlines
  // the whole transformers+ORT web stack (with top-level `import.meta`,
  // which is a parse-time SyntaxError in classic-script content scripts
  // and kills the listener on every page) and ships ~1.4MB of dead weight
  // into every frame.
  { in: resolve(src, "content/dom-capture-entry.js"), out: "dom-capture-entry.js",
    external: ["@huggingface/transformers"] },
];

for (const { in: entryIn, out, external: extraExternal = [] } of entries) {
  if (!existsSync(entryIn)) {
    console.error(`Missing entry: ${entryIn}`);
    process.exit(1);
  }
  const outfile = resolve(dist, out);
  mkdirSync(dirname(outfile), { recursive: true });

  await esbuild.build({
    entryPoints: [entryIn],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile,
    sourcemap: false,
    minify: false,
    mainFields: ["module", "browser", "main"],
    conditions: ["browser", "module", "import"],
    external: ["fs", "crypto", "path", "os", "module", "readline", ...extraExternal],
    loader: { ".wasm": "file" },
    footer: { js: buildStamp },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
  console.log(`[BUILD] Bundled: ${entryIn} -> ${outfile}`);
}

// 2. Copy HTML and CSS
function copyIfExists(srcPath, destPath) {
  if (existsSync(srcPath)) {
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    console.log(`[BUILD] Copied: ${srcPath} -> ${destPath}`);
  }
}

copyIfExists(resolve(src, "popup/popup.html"), resolve(dist, "popup.html"));
copyIfExists(resolve(src, "popup/popup.css"), resolve(dist, "popup.css"));
copyIfExists(resolve(src, "approval/approval.html"), resolve(dist, "approval.html"));
copyIfExists(resolve(src, "offscreen/offscreen.html"), resolve(dist, "offscreen.html"));
copyIfExists(resolve(src, "app/dashboard.html"), resolve(dist, "dashboard.html"));
copyIfExists(resolve(src, "app/dashboard.css"), resolve(dist, "dashboard.css"));

// 3. Copy Manifest
copyIfExists(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));

// 4. Copy Icons & Assets
const assetsSrc = resolve(root, "public/assets");
if (existsSync(assetsSrc)) {
  cpSync(assetsSrc, resolve(dist, "assets"), { recursive: true });
  console.log("[BUILD] Copied assets folder.");
}

// 5. Copy ORT wasm binaries to dist/ort/
const ortSrc = resolve(root, "node_modules/onnxruntime-web/dist");
const ortDest = resolve(dist, "ort");
if (existsSync(ortSrc)) {
  mkdirSync(ortDest, { recursive: true });
  for (const file of readdirSync(ortSrc)) {
    if (file.endsWith(".wasm") || file.endsWith(".mjs") || file.endsWith(".js")) {
      copyFileSync(resolve(ortSrc, file), resolve(ortDest, file));
    }
  }
  console.log("[BUILD] Copied ONNX Runtime Web WASM binaries to dist/ort/");
}

// 6. Copy required v7 models to dist/models/
//
// Default: bundle paddleocr (~168MB) + blazeface (~0.5MB) + Ettin NER
// (~270MB, complete in models/ettin-68m-nemotron-pii-onnx/). Ettin ships
// because NER runs on EVERY capture: a first-run 270MB download plus an
// unpinned remote revision would make the benchmarked model differ from
// the run model (offline-claim + drift fix, 2026-09-28). FastVLM stays
// first-run-download + browser-cached (too big to ship; fires rarely
// under the gate) — see v7-extension.js resolveNERModelPath fallback,
// FastVLM from_pretrained remote fallback, face/paddle HEAD->remote.
//
// For a personal full-offline build: INCLUDE_BIG_MODELS=1 npm run build
// (adds FastVLM from the local HF cache on top of the always-shipped set)
const includeBigModels = process.env.INCLUDE_BIG_MODELS === "1";
const requiredModelDirs = ["paddleocr", "blazeface", "ettin-68m-nemotron-pii-onnx"];
for (const sub of requiredModelDirs) {
  const srcSub = resolve(root, "models", sub);
  if (existsSync(srcSub)) {
    // Ettin ships WITHOUT its onnx/ subdir (model.onnx + model_q4.onnx,
    // ~523MB): upstream-repo strays that no code path loads (verified:
    // zero references in src/; loader reads root model.onnx via
    // model_file_name "model" + subfolder ""). Source files stay on disk.
    const skipEttinOnnxSubdir = sub === "ettin-68m-nemotron-pii-onnx"
      ? { filter: (s) => !s.endsWith(`${srcSub}${sep}onnx`) && !s.startsWith(`${srcSub}${sep}onnx${sep}`) }
      : {};
    cpSync(srcSub, resolve(dist, "models", sub), { recursive: true, dereference: true, ...skipEttinOnnxSubdir });
    console.log(`[BUILD] Copied models/${sub} to dist/models/${sub}`);
  }
}

// Bundle FastVLM only for full-offline builds. NOTE: previously this copied
// the same 1.4GB cache to TWO destinations (models/FastVLM-0.5B-ONNX AND
// models/onnx-community/FastVLM-0.5B-ONNX). Only the second path is ever
// resolved (env.localModelPath + modelId = models/onnx-community/...), so
// a single copy is correct. Default (slim) build skips FastVLM entirely.
if (includeBigModels) {
  const hfFastVlmCache = resolve(root, "node_modules/@huggingface/transformers/.cache/onnx-community/FastVLM-0.5B-ONNX");
  if (existsSync(hfFastVlmCache)) {
    const destFastVLMCommunity = resolve(dist, "models/onnx-community/FastVLM-0.5B-ONNX");
    mkdirSync(resolve(dist, "models/onnx-community"), { recursive: true });
    cpSync(hfFastVlmCache, destFastVLMCommunity, { recursive: true, dereference: true });
    console.log("[BUILD] Packaged FastVLM-0.5B-ONNX models into dist/models/ (full-offline)");
  } else {
    console.log("[BUILD] INCLUDE_BIG_MODELS=1 but FastVLM HF cache not found, skipping.");
  }
} else {
  console.log("[BUILD] Standard build: FastVLM excluded (first-run download, gated). Set INCLUDE_BIG_MODELS=1 for full-offline.");
}

// 7. Patch any remaining CDN strings in bundles to local chrome.runtime.getURL for MV3 CSP
for (const fname of ["offscreen.js", "popup.js", "dashboard.js"]) {
  const fpath = resolve(dist, fname);
  if (existsSync(fpath)) {
    let c = readFileSync(fpath, "utf8");
    c = c.replaceAll('`https://cdn.jsdelivr.net/npm/onnxruntime-web@${version2}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    c = c.replaceAll('`https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    c = c.replaceAll('`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    c = c.replaceAll('`ort@${version2}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    c = c.replaceAll('`ort@${version}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    c = c.replaceAll('`ort@${ONNX_ENV.versions.web}/dist/`', '(typeof chrome!=="undefined"&&chrome?.runtime?.getURL?chrome.runtime.getURL("ort/"):"ort/")');
    writeFileSync(fpath, c, "utf8");
  }
}

console.log("\n[BUILD SUCCESS] Chrome extension built ready to load in: " + dist);
