/* PerScope benchmark harness — visual-context task suite (Phase 6).
 *
 * Small deterministic tasks over the existing fixture pages. Static tasks are
 * evaluated against the fixture file source (proves the harness reads the same
 * page the browser renders); live tasks against a bench run record (fields the
 * harness already stores: ocrItems, tier2Fired, findingCount, faceCount).
 * Every evaluation returns {id, fixture, expected, actual, pass, evidence}.
 * Report task accuracy separately from detection metrics — never mixed.
 */

import fs from "node:fs";
import path from "node:path";

export function loadVisualTasks(dir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "visual-tasks.json"), "utf8"));
    return Array.isArray(doc.tasks) ? doc.tasks : [];
  } catch {
    return [];
  }
}

function stripTags(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstHeading(html) {
  const m = String(html ?? "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function countTag(html, tag) {
  const m = String(html ?? "").match(new RegExp(`<${tag}(\\s|>)`, "gi"));
  return m ? m.length : 0;
}

/* Evaluate ONE static task against fixture HTML source. */
export function evalStaticTask(task, htmlSource) {
  const src = String(htmlSource ?? "");
  let actual = null;
  switch (task.check) {
    case "heading-equals":
      actual = firstHeading(src);
      break;
    case "li-count":
      actual = countTag(src, "li");
      break;
    case "tr-count":
      actual = countTag(src, "tr");
      break;
    case "contains-text":
      actual = src.includes(String(task.expected));
      break;
    case "body-text-empty": {
      const body = (src.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || "";
      actual = stripTags(body).length === 0;
      break;
    }
    default:
      return { id: task.id, fixture: task.fixture, expected: task.expected, actual: "UNKNOWN_CHECK", pass: false, evidence: "static:fixture-source" };
  }
  const pass = task.check === "contains-text" ? actual === true : actual === task.expected;
  return { id: task.id, fixture: task.fixture, expected: task.expected, actual, pass, evidence: "static:fixture-source" };
}

/* Evaluate ONE live task against a bench run record. */
export function evalLiveTask(task, run) {
  const r = run || {};
  let actual = null;
  switch (task.check) {
    case "ocr-items-gt":
      actual = typeof r.ocrItems === "number" ? r.ocrItems : null;
      if (actual === null) return { id: task.id, fixture: task.fixture, expected: `>${task.expected}`, actual: "NOT_MEASURED", pass: false, evidence: "live:ocr-items-missing", skipped: true };
      return { id: task.id, fixture: task.fixture, expected: `>${task.expected}`, actual, pass: actual > task.expected, evidence: "live:ocr.itemsCount" };
    case "tier2-fired":
      actual = r.tier2Fired ?? null;
      if (actual === null) return { id: task.id, fixture: task.fixture, expected: task.expected, actual: "NOT_MEASURED", pass: false, evidence: "live:tier-path-missing", skipped: true };
      return { id: task.id, fixture: task.fixture, expected: task.expected, actual, pass: actual === task.expected, evidence: "live:FASTVLM-stage-status" };
    case "findings-eq":
      actual = typeof r.findingCount === "number" ? r.findingCount : null;
      if (actual === null) return { id: task.id, fixture: task.fixture, expected: task.expected, actual: "NOT_MEASURED", pass: false, evidence: "live:findings-missing", skipped: true };
      return { id: task.id, fixture: task.fixture, expected: task.expected, actual, pass: actual === task.expected, evidence: "live:final_findings.length" };
    case "face-done-with-count":
      actual = { faceDone: r.faceDone ?? null, faceCount: r.faceCount ?? null };
      if (r.faceDone !== true) return { id: task.id, fixture: task.fixture, expected: "FACE done with >=1 face", actual, pass: false, evidence: "live:FACE-stage-status" };
      return { id: task.id, fixture: task.fixture, expected: "FACE done with >=1 face", actual, pass: (r.faceCount ?? 0) >= 1, evidence: "live:FACE-stage-status+face-findings" };
    default:
      return { id: task.id, fixture: task.fixture, expected: task.expected, actual: "UNKNOWN_CHECK", pass: false, evidence: "live:unknown" };
  }
}

export function summarizeTasks(results) {
  const scored = results.filter((r) => !r.skipped);
  const passed = scored.filter((r) => r.pass).length;
  return {
    total: results.length,
    scored: scored.length,
    skipped: results.length - scored.length,
    passed,
    accuracy: scored.length ? passed / scored.length : null,
  };
}
