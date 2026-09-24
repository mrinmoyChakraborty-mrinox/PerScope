import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");

console.log("[VERIFY] Checking dist directory structure...");
if (!fs.existsSync(dist)) {
  console.error("FAIL: dist directory does not exist!");
  process.exit(1);
}

const requiredFiles = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "background.js",
  "offscreen.html",
  "offscreen.js",
  "dom-capture-entry.js",
  "dashboard.html",
  "dashboard.css",
  "dashboard.js",
  "ort/ort-wasm-simd-threaded.wasm",
  "models/blazeface/blaze.onnx",
  "models/FastVLM-0.5B-ONNX/config.json",
];

for (const req of requiredFiles) {
  const full = path.join(dist, req);
  if (!fs.existsSync(full)) {
    console.error(`FAIL: Missing required build artifact: ${req}`);
    process.exit(1);
  }
  console.log(`✓ Found: ${req} (${fs.statSync(full).size} bytes)`);
}

// Check for actual active forbidden Node imports
// dom-capture-entry.js is the browser-only DOM snapshot content script: it
// must stay free of node:-only imports exactly like the other dist/ bundles
// (document/window do not exist in Node, and Node builtins do not exist in
// the content-script context).
const jsFiles = ["popup.js", "background.js", "offscreen.js", "dashboard.js", "dom-capture-entry.js"];
const forbiddenPatterns = [
  { re: /from\s+["']node:fs["']|import\(["']node:fs/, name: "node:fs" },
  { re: /from\s+["']node:path["']|import\(["']node:path/, name: "node:path" },
  { re: /from\s+["']onnxruntime-node["']|require\(["']onnxruntime-node/, name: "onnxruntime-node" },
  { re: /from\s+["']sharp["']|require\(["']sharp["']/, name: "sharp" },
  { re: /process\.exit\s*\(/, name: "process.exit" },
];

let foundErrors = [];
for (const js of jsFiles) {
  const p = path.join(dist, js);
  const content = fs.readFileSync(p, "utf8");
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const { re, name } of forbiddenPatterns) {
    if (re.test(withoutComments)) {
      foundErrors.push(`${js}: Contains forbidden import ${name}`);
    }
  }
}

if (foundErrors.length > 0) {
  console.error("FAIL: Found forbidden imports:");
  for (const err of foundErrors) console.error("  - " + err);
  process.exit(1);
}
console.log("✓ Zero forbidden Node.js imports found in browser bundles.");

// Check manifest JSON
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) {
  console.error("FAIL: Manifest version is not 3!");
  process.exit(1);
}
console.log(`✓ Manifest V3 validated: "${manifest.name}" v${manifest.version}`);

console.log("\n[VERIFICATION PASSED] All extension checks passed successfully!");
