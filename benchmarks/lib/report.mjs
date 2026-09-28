/* PerScope benchmark harness - output writers.
   results/<timestamp>.json holds full raw data (git-ignored: bulky);
   latest.md is the tracked, human-readable, cross-commit-diffable summary. */

import fs from "node:fs";
import path from "node:path";

export function stampName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

export function writeResults(resultsDir, payload) {
  fs.mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `${stampName()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function fmt(v, digits = 1) {
  if (v === null || v === undefined) return "-";
  return typeof v === "number" ? v.toFixed(digits) : String(v);
}

function statsRow(name, s) {
  if (!s || s.n === 0) return `| ${name} | - | - | - | - | 0 |`;
  return `| ${name} | ${fmt(s.mean)} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${s.n} |`;
}

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").slice(0, 80);
}

export function renderLatestMd(summary) {
  const L = [];
  L.push(`# PerScope benchmark - latest`);
  L.push(``);
  L.push(`- Date (UTC): ${summary.date}`);
  L.push(`- Commit: ${summary.commit}`);
  L.push(`- Device: ${summary.device} (WebGPU tier/agent: ${summary.deviceDetail})`);
  L.push(`- Runs per fixture: ${summary.runsPerFixture} steady + 1 cold-start (reported separately, excluded from steady stats)`);
  L.push(`- Fixtures: ${summary.fixtures.map((f) => f.id).join(", ")}`);
  L.push(`- MCP: ${summary.mcpUrl} * fixtures: ${summary.fixtureBase}`);
  L.push(``);
  L.push(`## Steady-state stage latency (ms, all fixtures pooled)`);
  L.push(``);
  L.push(`| stage | mean | p50 | p95 | max | n |`);
  L.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const [stage, s] of Object.entries(summary.stageStats)) L.push(statsRow(stage, s));
  L.push(``);
  L.push(`Total (pipeline totalTimeMs): ${statsRow("total", summary.totalStats).replace("| total |", "| total |")}`);
  L.push(``);
  L.push(`## Cold start vs steady (total ms per fixture)`);
  L.push(``);
  L.push(`| fixture | cold (run 1) | steady p50 | steady p95 |`);
  L.push(`| --- | ---: | ---: | ---: |`);
  for (const f of summary.fixtures) {
    L.push(`| ${esc(f.id)} | ${fmt(f.coldTotal, 0)} | ${fmt(f.steadyTotal?.median, 0)} | ${fmt(f.steadyTotal?.p95, 0)} |`);
  }
  L.push(``);
  L.push(`## Memory (JS heap, offscreen document, per capture_tab run)`);
  L.push(``);
  L.push(`| fixture | p50 before (MB) | p50 delta/run (KB) | drift slope (KB/run) | verdict |`);
  L.push(`| --- | ---: | ---: | ---: | --- |`);
  for (const f of summary.fixtures) {
    const m = f.memory || {};
    L.push(
      `| ${esc(f.id)} | ${fmt(m.medianBeforeMB)} | ${fmt(m.medianDeltaKB)} | ${fmt(m.slopeKBPerRun)} | ${esc(m.verdict || "n/a")} |`,
    );
  }
  if (summary.memoryNote) {
    L.push(``);
    L.push(`> ${summary.memoryNote}`);
  }
  L.push(``);
  L.push(`## Tier escalation (detection path per run)`);
  L.push(``);
  L.push(`Escalation rate (Tier 2 adjudication fired): **${fmt(summary.escalationRatePct, 1)}%** (${summary.tier2Runs}/${summary.totalRuns} steady runs)`);
  L.push(``);
  L.push(`| path | runs | share |`);
  L.push(`| --- | ---: | ---: |`);
  for (const [p, c] of Object.entries(summary.tierPaths)) {
    L.push(`| ${esc(p)} | ${c} | ${fmt((100 * c) / Math.max(1, summary.totalRuns), 1)}% |`);
  }
  L.push(``);
  L.push(`Expected by construction: clean ~0% Tier 2 (text-free page => FastVLM skips); ambiguous ~100%.`);
  L.push(``);
  L.push(`## CPU (Chrome process CPU-seconds per capture_tab run, Windows only)`);
  L.push(``);
  L.push(`Wall time says WHERE time goes; CPU seconds say WHAT burns. Per-stage CPU attribution is impossible from outside the renderer, so CPU is per-run and stages stay per-stage. >100% utilization = multi-threaded (WASM/model workers).`);
  L.push(``);
  L.push(`| fixture | CPU/run p50 (s) | utilization p50 (%) |`);
  L.push(`| --- | ---: | ---: |`);
  for (const f of summary.fixtures) {
    L.push(`| ${esc(f.id)} | ${fmt(f.cpuSecP50)} | ${fmt(f.cpuPctP50, 0)} |`);
  }
  L.push(``);
  L.push(`## Per-fixture breakdown`);
  L.push(``);
  L.push(`| fixture | designed to exercise | steady p50 total (ms) | findings/run (p50) | entity types seen | T2 rate |`);
  L.push(`| --- | --- | ---: | ---: | --- | ---: |`);
  for (const f of summary.fixtures) {
    L.push(
      `| ${esc(f.id)} | ${esc(f.exercises)} | ${fmt(f.steadyTotal?.median, 0)} | ${fmt(f.medianFindings, 0)} | ${esc((f.entityTypes || []).join(", "))} | ${fmt(f.tier2RatePct, 0)}% |`,
    );
  }
  L.push(``);
  L.push(`## Accuracy proxies (no ground truth - counts only, never precision/recall)`);
  L.push(``);
  L.push(`| fixture | finding-type histogram (steady runs pooled) | confidence bins (p25/median/p75 of scores) | adjudication fallback share |`);
  L.push(`| --- | --- | --- | ---: |`);
  for (const f of summary.fixtures) {
    const hist = Object.entries(f.typeHistogram || {})
      .map(([t, c]) => `${t}:${c}`)
      .join(", ");
    const cb = f.confidenceBands;
    L.push(
      `| ${esc(f.id)} | ${esc(hist) || "-"} | ${cb ? `${fmt(cb.p25, 3)}/${fmt(cb.median, 3)}/${fmt(cb.p75, 3)}` : "-"} | ${fmt(f.fallbackSharePct, 0)}% |`,
    );
  }
  L.push(``);
  L.push(`> Follow-up: labeled fixtures with span-level ground truth for real precision/recall (PS metrics 1-3).`);
  L.push(`> Until then these proxies are the baseline to diff against.`);
  L.push(``);
  L.push(`## Flags`);
  L.push(``);
  if (summary.flags.length) for (const fl of summary.flags) L.push(`- [!] ${fl}`);
  else L.push(`- none`);
  L.push(``);
  return L.join("\n");
}
