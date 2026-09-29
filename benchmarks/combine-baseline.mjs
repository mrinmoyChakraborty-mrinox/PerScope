#!/usr/bin/env node
/* PerScope benchmark harness — multi-batch baseline combiner (reporting only).
 *
 * Live T2 fixtures wedge intermittently (FastVLM hang kills the offscreen
 * document), so a 20-steady baseline is banked in several batch files. This
 * tool aggregates batch JSONs into ONE official baseline using the EXACT same
 * per-fixture code as a live run (aggregateFixture imported from run.mjs) and
 * the same suite rollups. Micro-aggregation across batches is statistically
 * identical to one long run: every batch contributes 1 excluded cold + N
 * clean steady runs; failed runs stay counted, never averaged in.
 *
 * Usage:
 *   node benchmarks/combine-baseline.mjs --files a.json,b.json,...
 *     [--results-dir=benchmarks/results] [--label=official-baseline]
 *     [--ground-truth-dir=benchmarks/ground_truth]
 *     [--fixtures-root=benchmarks/fixtures]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, summarizeStages, round1 } from "./lib/stats.mjs";
import { loadGroundTruth, scoreRun, aggregateScores } from "./lib/accuracy.mjs";
import { loadVisualTasks, evalStaticTask, summarizeTasks } from "./lib/visual-tasks.mjs";
import { renderLatestMd } from "./lib/report.mjs";
import { aggregateFixture, collectEnv, gitCommit, FIXTURES } from "./run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    files: [],
    resultsDir: path.join(HERE, "results"),
    label: "official-baseline",
    groundTruthDir: path.join(HERE, "ground_truth"),
    fixturesRoot: path.join(HERE, "fixtures"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      return argv[++i];
    };
    const key = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    const v = take();
    if (key === "--files") out.files = (v || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (key === "--results-dir") out.resultsDir = v;
    else if (key === "--label") out.label = v;
    else if (key === "--ground-truth-dir") out.groundTruthDir = v;
    else if (key === "--fixtures-root") out.fixturesRoot = v;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!out.files.length) throw new Error("pass --files=a.json,b.json,... (batch result JSONs in time order)");
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const batches = opts.files.map((f) => {
    const p = path.isAbsolute(f) ? f : path.join(opts.resultsDir, f);
    return { file: path.basename(p), payload: JSON.parse(fs.readFileSync(p, "utf8")) };
  });

  // Group runs per fixture across batches (time order = file order given).
  const perFixture = new Map(); // id -> {fixture, colds:[], steady:[]}
  const batchIndex = [];
  for (const b of batches) {
    for (const r of b.payload.runs || []) {
      const id = r.fixture.id;
      if (!perFixture.has(id)) perFixture.set(id, { fixture: r.fixture, colds: [], steady: [] });
      const g = perFixture.get(id);
      if (r.cold) g.colds.push({ batch: b.file, ...r.cold });
      for (const s of r.steady || []) g.steady.push({ batch: s.batch || b.file, ...s });
      batchIndex.push({ batch: b.file, fixture: id, aborted: b.payload.aborted || null });
    }
  }

  const groundTruth = loadGroundTruth(opts.groundTruthDir);
  const visualTasks = loadVisualTasks(opts.groundTruthDir);
  const fixtureSources = {};
  for (const [id] of perFixture) {
    const fx = FIXTURES.find((f) => f.id === id);
    try {
      fixtureSources[id] = fs.readFileSync(path.join(opts.fixturesRoot, fx ? fx.file : `${id}.html`), "utf8");
    } catch { /* static tasks for this fixture are skipped */ }
  }
  const visualStatic = visualTasks
    .filter((t) => t.kind === "static")
    .map((t) => {
      const src = fixtureSources[t.fixture];
      if (src === undefined) return { ...t, actual: "FIXTURE_SOURCE_MISSING", pass: false, evidence: "static:unreadable", skipped: true };
      return evalStaticTask(t, src);
    });
  const ctx = { groundTruth, visualTasks };
  const flags = [];

  const agg = [...perFixture.entries()].map(([id, g]) => {
    // Earliest cold is the representative warm-up; ALL colds are preserved
    // in batchColds and every one of them is excluded from steady stats.
    const a = aggregateFixture(g.fixture, g.colds[0] || { ok: false, reason: "no cold recorded" }, g.steady, ctx);
    a.batches = [...new Set(g.steady.map((s) => s.batch).concat(g.colds.map((c) => c.batch)))];
    a.batchColds = g.colds.map((c) => ({ batch: c.batch, totalMs: c.ok ? c.totalMs : null, degraded: !!c.degraded }));
    return a;
  });

  const okAll = [...perFixture.values()].flatMap((g) => g.steady.filter((r) => r.ok && !r.degraded));
  const failedAll = [...perFixture.values()].flatMap((g) => g.steady.filter((r) => !r.ok));
  const degradedAll = [...perFixture.values()].flatMap((g) => g.steady.filter((r) => r.ok && r.degraded));
  const deviceSeen = new Set(okAll.map((r) => `${r.deviceTier}${r.deviceLabel ? ` (${r.deviceLabel})` : ""}`));

  const allStages = summarizeStages(okAll.filter((r) => !r.degraded));
  const cleanOk = okAll.filter((r) => !r.degraded);
  const allTotals = summarize(cleanOk.map((r) => r.totalMs).filter((v) => typeof v === "number"));
  const tierPaths = {};
  let tier2Runs = 0;
  for (const r of cleanOk) {
    tierPaths[r.tierPath] = (tierPaths[r.tierPath] || 0) + 1;
    if (r.tier2Fired) tier2Runs++;
  }

  const piiScores = [];
  for (const [id, g] of perFixture) {
    const gt = groundTruth[id];
    if (!gt) continue;
    for (const r of g.steady.filter((x) => x.ok && !x.degraded)) piiScores.push(scoreRun(gt.entities, r.findingDetails || []));
  }
  const piiOverall = piiScores.length ? { runs: piiScores.length, ...aggregateScores(piiScores) } : null;
  const redMeans = (key) => {
    const v = agg.map((f) => f.redaction?.[key]).filter((x) => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const hasRedaction = agg.some((f) => f.redaction);
  const redactionOverall = hasRedaction
    ? {
      textCoverageMean: redMeans("textCoverageMean"),
      underRedactionMean: redMeans("underRedactionMean"),
      meanIoUMean: redMeans("meanIoUMean"),
      boxRecallAt50Mean: redMeans("boxRecallAt50Mean"),
      overRedactionMean: redMeans("overRedactionMean"),
      preservationMean: redMeans("preservationMean"),
      ocrLeakMean: redMeans("ocrLeakMean"),
      ocrPreservedMean: redMeans("ocrPreservedMean"),
    }
    : null;
  const visualStaticSummary = summarizeTasks(visualStatic);
  const visualLiveScored = agg.reduce((a, f) => a + (f.visualLive?.scored || 0), 0);
  const visualLivePassed = agg.reduce((a, f) => a + (f.visualLive?.passed || 0), 0);
  const visualOverall = {
    static: visualStaticSummary,
    staticResults: visualStatic,
    live: { scored: visualLiveScored, passed: visualLivePassed, accuracy: visualLiveScored ? visualLivePassed / visualLiveScored : null },
  };
  const modelsSeen = {};
  for (const r of okAll) {
    for (const [k, v] of Object.entries(r.models || {})) {
      if (typeof v === "string" && v) (modelsSeen[k] = modelsSeen[k] || new Set()).add(v);
    }
  }
  const models = Object.fromEntries(Object.entries(modelsSeen).map(([k, s]) => [k, [...s]]));

  for (const f of agg) {
    if (f.failedRuns) flags.push(`${f.id}: ${f.failedRuns} run(s) failed (FastVLM-hang wedge + unpaired follow-ups; see batch JSONs).`);
    if (f.degradedRuns) flags.push(`${f.id}: ${f.degradedRuns} DEGRADED (excluded from latency stats).`);
    if (String(f.memory.verdict).startsWith("LEAK SIGNAL")) flags.push(`${f.id}: ${f.memory.verdict}.`);
  }
  const gpuEventRuns = okAll.filter((r) => Array.isArray(r.gpuEvents) && r.gpuEvents.length > 0).length;
  if (gpuEventRuns) flags.push(`GPU EVENTS in ${gpuEventRuns}/${okAll.length} runs.`);
  const wedgeBatches = batches.filter((b) => b.payload.aborted).map((b) => b.file);
  if (wedgeBatches.length) {
    flags.push(
      `RELIABILITY: ${wedgeBatches.length} batch(es) aborted by FastVLM-hang wedge killing the extension ` +
      `(${wedgeBatches.join(", ")}); ${failedAll.length} failed captures excluded from stats, all preserved in batch JSONs.`,
    );
  }

  const summary = {
    date: new Date().toISOString(),
    commit: gitCommit(),
    baseline: "official",
    aggregation: `multi-batch micro-aggregation of ${batches.length} batch files (${batches.map((b) => b.file).join(", ")}); per-fixture stats via aggregateFixture (same code as live runs)`,
    device: [...deviceSeen].join("; ") || "unknown",
    deviceDetail: "record-only: per-run device forcing is not possible via bridge (offscreen passes options:{})",
    runsPerFixture: 20,
    mcpUrl: batches[0].payload.summary?.mcpUrl || "http://127.0.0.1:7332/mcp",
    fixtureBase: batches[0].payload.summary?.fixtureBase || "unknown",
    fixtures: agg,
    stageStats: allStages,
    totalStats: allTotals,
    totalRuns: cleanOk.length,
    failedRuns: failedAll.length,
    degradedRuns: degradedAll.length,
    failureRatePct: cleanOk.length + failedAll.length + degradedAll.length
      ? round1((100 * (failedAll.length + degradedAll.length)) / (cleanOk.length + failedAll.length + degradedAll.length))
      : 0,
    tier2Runs,
    escalationRatePct: cleanOk.length ? round1((100 * tier2Runs) / cleanOk.length) : 0,
    tierPaths,
    memoryNote:
      "Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). " +
      "A rising post-run baseline across identical runs is the leak signal - slope >256KB/run with >1MB total growth flags it.",
    flags,
    env: collectEnv(),
    models,
    groundTruth: {
      dir: "benchmarks/ground_truth",
      fixtures: Object.fromEntries(Object.entries(groundTruth).map(([id, g]) => [id, { file: g.file, entities: g.entities.length }])),
    },
    piiOverall,
    redactionOverall,
    visualOverall,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  fs.mkdirSync(opts.resultsDir, { recursive: true });
  const jsonFile = path.join(opts.resultsDir, `${opts.label}-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({ summary, batches: batches.map((b) => b.file) }, null, 2));
  const latestFile = path.join(HERE, "latest.md");
  fs.writeFileSync(latestFile, renderLatestMd(summary));
  console.log(`wrote ${jsonFile}\nwrote ${latestFile}`);
  console.log(`steady=${summary.totalRuns} failed=${summary.failedRuns} degraded=${summary.degradedRuns} esc=${summary.escalationRatePct}%`);
  for (const fl of flags) console.log(`  [!] ${fl}`);
}

main();
