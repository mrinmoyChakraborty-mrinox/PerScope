import fs from "node:fs";

// Check all cross-file exports and usages
const modules = [
  { path: "src/pipeline/heuristics.js", name: "./heuristics.js" },
  { path: "src/pipeline/ner-utils.js", name: "./ner-utils.js" },
  { path: "src/pipeline/prompts.js", name: "./prompts.js" },
  { path: "src/pipeline/safety.js", name: "./safety.js" },
  { path: "src/pipeline/face.js", name: "./face.js" },
  { path: "src/pipeline/canvas-redactor.js", name: "./canvas-redactor.js" },
  { path: "src/pipeline/gpu.js", name: "./gpu.js" },
];

const targetFiles = [
  "src/pipeline/heuristics.js",
  "src/pipeline/ner-utils.js",
  "src/pipeline/prompts.js",
  "src/pipeline/safety.js",
  "src/pipeline/face.js",
  "src/pipeline/canvas-redactor.js",
  "src/pipeline/v7-extension.js",
];

for (const mod of modules) {
  const modContent = fs.readFileSync(mod.path, "utf8");
  const exportMatches = modContent.matchAll(/export\s+(?:function|const|let|var)\s+([a-zA-Z0-9_]+)|export\s*\{([^}]+)\}/g);
  const exports = new Set();
  for (const m of exportMatches) {
    if (m[1]) exports.add(m[1].trim());
    if (m[2]) {
      m[2].split(",").forEach(x => {
        const item = x.trim();
        if (item) exports.add(item);
      });
    }
  }

  for (const target of targetFiles) {
    if (target === mod.path) continue;
    const content = fs.readFileSync(target, "utf8");
    const importRegex = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*["'](?:\\.\\/)?${mod.name.replace("./", "").replace(".js", "")}(?:\\.js)?["']`);
    const importMatch = content.match(importRegex);
    const imported = new Set(importMatch ? importMatch[1].split(",").map(x => x.trim()) : []);

    for (const exp of exports) {
      const usageRegex = new RegExp(`\\b${exp}\\b`);
      if (usageRegex.test(content) && !imported.has(exp)) {
        console.log(`[MISSING] ${target} needs '${exp}' from ${mod.path}`);
      }
    }
  }
}
