import fs from "fs";
import path from "path";
import matter from "gray-matter";

const DOCS_DIR = path.join(process.cwd());

// Files we expose as team docs (top-level + tasks)
export const DOC_ENTRIES = [
  { slug: "ppt-improvement-plan", file: "PPT_IMPROVEMENT_PLAN.md", title: "PPT — Final Merged Improvement Plan", group: "Pitch" },
  { slug: "kickoff", file: "KICKOFF.md", title: "Kickoff — What to Add", group: "Meta" },
  { slug: "architecture", file: "architecture.md", title: "Locked Architecture (v3)", group: "Core" },
  { slug: "tool-schema", file: "tool-schema.md", title: "Tool Schema — 7 tools", group: "Core" },
  { slug: "build-order", file: "build-order.md", title: "Build Order (10 steps)", group: "Core" },
  { slug: "security-model", file: "security-model.md", title: "Security Model", group: "Core" },
  { slug: "limitations", file: "limitations.md", title: "Honest Limitations", group: "Core" },
  { slug: "changelog", file: "CHANGELOG.md", title: "Changelog", group: "Meta" },
  { slug: "tasks/01-lead-integration", file: "tasks/01-lead-integration.md", title: "Person 1 — Lead / Integration", group: "Tasks" },
  { slug: "tasks/02-perception", file: "tasks/02-perception.md", title: "Person 2 — Perception (Jeet)", group: "Tasks" },
  { slug: "tasks/03-privacy-redaction", file: "tasks/03-privacy-redaction.md", title: "Person 3 — Privacy & Redaction (Koyel)", group: "Tasks" },
  { slug: "tasks/04-extension-automation", file: "tasks/04-extension-automation.md", title: "Person 4 — Extension (Shritama)", group: "Tasks" },
  { slug: "tasks/05-server-bridge-playground", file: "tasks/05-server-bridge-playground.md", title: "Person 5 — Server/Bridge (Banashree)", group: "Tasks" },
  { slug: "tasks/06-research-qa", file: "tasks/06-research-qa.md", title: "Person 6 — Research & QA (Adreeja)", group: "Tasks" },
];

export function getDocSlugs() {
  return DOC_ENTRIES.map((d) => d.slug);
}

export function getDoc(slug: string) {
  const entry = DOC_ENTRIES.find((d) => d.slug === slug);
  if (!entry) return null;
  const full = path.join(DOCS_DIR, entry.file);
  if (!fs.existsSync(full)) return { entry, content: `> Missing file: \`${entry.file}\`\n\nCreate this file to make the page live.`, data: {} };
  const raw = fs.readFileSync(full, "utf8");
  const { content, data } = matter(raw);
  return { entry, content, data };
}

export function getAllDocsGrouped() {
  const groups: Record<string, typeof DOC_ENTRIES> = {};
  for (const e of DOC_ENTRIES) {
    if (!groups[e.group]) groups[e.group] = [];
    groups[e.group].push(e);
  }
  return groups;
}
