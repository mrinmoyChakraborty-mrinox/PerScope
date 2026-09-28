/* PerScope benchmark harness — PII detection accuracy (Phase 4).
 *
 * Compares ground_truth entities (benchmarks/ground_truth/*.json) against
 * evidence.final_findings from live capture_tab runs. Pure + headless-testable.
 *
 * Definitions (explicit, deterministic):
 *   - normalize(s): lowercase; spoken obfuscations " dot "->".", " at "->"@";
 *     then strip every char except [a-z0-9@.]. Empty result never matches.
 *   - textMatch(gtText, findingText): normalized containment in EITHER direction,
 *     with the shorter side >= 3 chars (guards single-char noise).
 *   - typeCompatible(gtType, findingEntity): equal (case-insensitive) OR alias
 *     pair (PERSON_NAME~FIRST_NAME/LAST_NAME/NAME, ADDRESS~STREET_ADDRESS,
 *     DATE~DOB/TIME/DATE). A text match with an incompatible type still counts
 *     as TP (the value was detected) but increments typeMismatch.
 *   - TP: a REDACT ground-truth entity matched by >= 1 finding (textMatch).
 *   - FP: a finding whose text matches NO REDACT entity. Findings matching a
 *     LEAVE entity are additionally counted as overRedact (wrong-direction hit).
 *   - FN: a REDACT entity matched by NO finding.
 *   - precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R).
 *     null when the denominator is 0 (rendered as n/a, never zero-filled).
 * Aggregation is micro (TP/FP/FN summed) across runs, then per fixture,
 * per entity type, and overall.
 */

import fs from "node:fs";
import path from "node:path";

const TYPE_ALIASES = new Map([
  ["PERSON_NAME", new Set(["PERSON_NAME", "FIRST_NAME", "LAST_NAME", "FULL_NAME", "NAME"])],
  ["ADDRESS", new Set(["ADDRESS", "STREET_ADDRESS", "LOCATION"])],
  ["DATE", new Set(["DATE", "DOB", "TIME"])],
]);

export function normalizeText(s) {
  let t = String(s ?? "").toLowerCase();
  t = t.replace(/\s+dot\s+/g, ".").replace(/\s+at\s+/g, "@");
  t = t.replace(/[^a-z0-9@.]/g, "");
  return t;
}

export function textMatch(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (Math.min(na.length, nb.length) < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

export function typeCompatible(gtType, findingEntity) {
  const g = String(gtType ?? "").toUpperCase();
  const f = String(findingEntity ?? "unknown").toUpperCase();
  if (g === f) return true;
  const aliases = TYPE_ALIASES.get(g);
  return aliases ? aliases.has(f) : false;
}

export function loadGroundTruth(dir) {
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "visual-tasks.json");
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const entities = Array.isArray(doc.entities) ? doc.entities : [];
      const fixture = doc._fixture || f.replace(/\.json$/, ".html");
      const id = fixture.replace(/\.html$/, "");
      out[id] = { file: f, fixture, entities };
    } catch {
      /* a malformed GT file must not break the latency benchmark */
    }
  }
  return out;
}

/* Score ONE run's findings against ONE fixture's GT.
 * findings: [{entity, text}] (bbox ignored here; redaction.mjs uses it). */
export function scoreRun(gtEntities, findings) {
  const redact = (gtEntities || []).filter((e) => e.action === "REDACT");
  const leave = (gtEntities || []).filter((e) => e.action === "LEAVE");
  const fs = Array.isArray(findings) ? findings : [];
  const matchedGt = new Set();
  const matchedFinding = new Set();
  let typeMismatch = 0;
  const pairs = [];
  for (const f of fs) {
    for (const g of redact) {
      if (!g.text) continue; // visual-only GT (FACE bbox) is scored in redaction.mjs, not here
      if (textMatch(g.text, f.text)) {
        matchedGt.add(g.id);
        matchedFinding.add(fs.indexOf(f));
        pairs.push({ gt: g.id, findingEntity: f.entity ?? null });
        if (!typeCompatible(g.entity_type, f.entity)) typeMismatch++;
        break;
      }
    }
  }
  let overRedact = 0;
  for (let i = 0; i < fs.length; i++) {
    if (matchedFinding.has(i)) continue;
    for (const g of leave) {
      if (!g.text) continue;
      if (textMatch(g.text, fs[i].text)) {
        overRedact++;
        break;
      }
    }
  }
  const tp = matchedGt.size;
  const fp = fs.length - matchedFinding.size;
  const fn = redact.filter((g) => g.text && !matchedGt.has(g.id)).length;
  return { tp, fp, fn, typeMismatch, overRedact, pairs };
}

export function prf(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return { precision, recall, f1 };
}

/* Micro-aggregate a list of per-run scoreRun() results. */
export function aggregateScores(scores) {
  const tp = scores.reduce((a, s) => a + s.tp, 0);
  const fp = scores.reduce((a, s) => a + s.fp, 0);
  const fn = scores.reduce((a, s) => a + s.fn, 0);
  const typeMismatch = scores.reduce((a, s) => a + (s.typeMismatch || 0), 0);
  const overRedact = scores.reduce((a, s) => a + (s.overRedact || 0), 0);
  return { tp, fp, fn, typeMismatch, overRedact, runs: scores.length, ...prf(tp, fp, fn) };
}

/* Per-entity-type breakdown: a finding contributes to the type bucket of the
 * GT entity it matched (or "UNMATCHED" when it matched nothing). */
export function scoreByType(gtEntities, findingsList) {
  const buckets = new Map(); // gtType -> {tp, fp, fn}
  const ensure = (t) => {
    if (!buckets.has(t)) buckets.set(t, { tp: 0, fp: 0, fn: 0 });
    return buckets.get(t);
  };
  for (const g of gtEntities || []) {
    if (g.action !== "REDACT" || !g.text) continue;
    ensure(g.entity_type);
  }
  for (const findings of findingsList) {
    const fs = Array.isArray(findings) ? findings : [];
    const matchedFinding = new Set();
    for (const g of (gtEntities || []).filter((e) => e.action === "REDACT" && e.text)) {
      let hit = false;
      for (const f of fs) {
        if (textMatch(g.text, f.text)) {
          hit = true;
          matchedFinding.add(fs.indexOf(f));
        }
      }
      if (hit) ensure(g.entity_type).tp++;
      else ensure(g.entity_type).fn++;
    }
    for (let i = 0; i < fs.length; i++) {
      if (!matchedFinding.has(i)) {
        const key = `UNMATCHED(${String(fs[i].entity || "unknown")})`;
        ensure(key).fp++;
      }
    }
  }
  const out = {};
  for (const [t, v] of buckets) out[t] = { ...v, ...prf(v.tp, v.fp, v.fn) };
  return out;
}
