#!/usr/bin/env node
/* PerScope benchmark harness - runner (Node builtins only).
 *
 * Bring-up order (same as everything else in this project):
 *   1. bridge daemon running  (bridge/bin/cli.js daemon;
 *      raise PERSCOPE_TOOL_TIMEOUT_MS for bench sessions, cold model
 *      loads exceed the 60s default - see README)
 *   2. extension loaded + paired (pair once via dashboard; token persists)
 *   3. `npm run benchmark` from the repo root
 *
 * The harness speaks MCP-over-HTTP to the daemon (no client pairing of
 * its own) and serves fixtures on 127.0.0.1. capture_tab is active-tab
 * only by beta design, so each fixture batch is guided: open the printed
 * URL, make it the active tab, press Enter. list_tabs verifies the active
 * tab before any timed run starts and aborts loudly on mismatch.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { checkHealth, callTool, listTabs, DEFAULT_MCP_URL, DEFAULT_HEALTH_URL } from "./lib/mcp-client.mjs";
import { startFixtureServer } from "./lib/serve.mjs";
import { summarize, summarizeStages, slope, percentile, round1, median } from "./lib/stats.mjs";
import { sampleChromeCpuSeconds } from "./lib/cpu.mjs";
import { writeResults, renderLatestMd, stampName } from "./lib/report.mjs";
import { loadGroundTruth, scoreRun, aggregateScores, scoreByType } from "./lib/accuracy.mjs";
import { evaluateRedaction } from "./lib/redaction.mjs";
import { loadVisualTasks, evalStaticTask, evalLiveTask, summarizeTasks } from "./lib/visual-tasks.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO_ROOT = path.resolve(HERE, "..");
const DEFAULT_FIXTURES_ROOT = path.join(HERE, "fixtures");
const DEFAULT_RESULTS_DIR = path.join(HERE, "results");
const DEFAULT_LATEST_FILE = path.join(HERE, "latest.md");
const DEFAULT_GROUND_TRUTH_DIR = path.join(HERE, "ground_truth");
const DEFAULT_PORT = 7341;

export const FIXTURES = [
  { id: "text-heavy", file: "text-heavy.html", exercises: "dense synthetic PII text; full T0+T1+T2 path" },
  { id: "document", file: "document.html", exercises: "scanned-document image with photo + print; OCR-on-image + face" },
  { id: "face", file: "face.html", exercises: "large ID photo + sparse text; face-detection exercise" },
  { id: "clean", file: "clean.html", exercises: "zero rendered text; best-case fast path, Tier 2 must skip" },
  { id: "ambiguous", file: "ambiguous.html", exercises: "masked/partial PII strings; forces Tier 2 adjudication" },
  { id: "invoice-v2", file: "invoice-v2.html", exercises: "invoice with NON-placeholder domains; measurable PII recall + decoys" },
];

const LEAK_TOTAL_KB = 1024;

function parseArgs(argv) {
  const out = {
    runs: 20,
    fixtures: "all",
    port: DEFAULT_PORT,
    fixtureBase: null,
    mcpUrl: DEFAULT_MCP_URL,
    healthUrl: DEFAULT_HEALTH_URL,
    timeoutMs: 600_000,
    gapMs: 2000,
    yes: false,
    selfTest: false,
    // Phase 4: offscreen recycle override forwarded as capture_tab's
    // recycleAfterCaptures. null = omit (extension default 15). 0 = never
    // recycle (Phase 3 correlation run: recycling would mask degradation).
    recycleAfter: null,
    fixturesRoot: DEFAULT_FIXTURES_ROOT,
    resultsDir: DEFAULT_RESULTS_DIR,
    latestFile: DEFAULT_LATEST_FILE,
    groundTruthDir: DEFAULT_GROUND_TRUTH_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Both --flag=value and --flag value forms.
    const take = () => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      return argv[++i];
    };
    const key = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    const v = a.includes("=") || !["--yes", "--self-test", "--help", "-h"].includes(a) ? take() : undefined;
    if (key === "--runs") out.runs = Math.max(1, parseInt(v, 10) || 20);
    else if (key === "--fixtures") out.fixtures = v || "all";
    else if (key === "--port") out.port = parseInt(v, 10) || DEFAULT_PORT;
    else if (key === "--fixture-base") out.fixtureBase = v;
    else if (key === "--mcp-url") out.mcpUrl = v;
    else if (key === "--timeout-ms") out.timeoutMs = parseInt(v, 10) || 600_000;
    else if (key === "--gap-ms") out.gapMs = Math.max(0, parseInt(v, 10) || 0);
    else if (key === "--recycle-after") out.recycleAfter = v === "" ? null : Math.max(0, parseInt(v, 10) || 0);
    else if (key === "--fixtures-root") out.fixturesRoot = v;
    else if (key === "--results-dir") out.resultsDir = v;
    else if (key === "--latest-file") out.latestFile = v;
    else if (key === "--ground-truth-dir") out.groundTruthDir = v;
    else if (key === "--yes") out.yes = true;
    else if (key === "--self-test") out.selfTest = true;
    else if (key === "--help" || key === "-h") {
      console.log(
          `usage: npm run benchmark -- [--runs=20] [--fixtures=all|id,...] [--port=7341]\n` +
          `  [--mcp-url=...] [--timeout-ms=600000] [--gap-ms=2000] [--yes]\n` +
          `  [--fixtures-root=...] [--results-dir=...] [--latest-file=...] [--self-test]\n` +
          `  [--ground-truth-dir=...] [--recycle-after=N] (offscreen recycle override: 0 = never, omit = default 15)`,
      );
      process.exit(0);
    } else throw new Error(`unknown flag ${a} (see --help)`);
  }
  return out;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

function gitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export { gitCommit };

/* Environment actually observable from the bench host. Anything we cannot
 * observe is reported as NOT MEASURED rather than guessed (Phase 7 rule). */
export function collectEnv() {
  let cpuModel = null;
  let cpuCount = null;
  try {
    const cpus = os.cpus();
    cpuCount = cpus.length;
    cpuModel = cpus[0]?.model || null;
  } catch { /* leave null */ }
  return {
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuCount,
    cpuModel,
    ramGB: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    browser: "NOT MEASURED (capture_tab evidence carries no browser version; record chrome://version in controlled sessions)",
    gpu: "see summary.device (record-only tier label from the extension; full GPU model is NOT MEASURED)",
  };
}

/* ---- per-run extraction (evidence shape -> bench record) ---- */

function stageStatus(stages, name) {
  return (stages || []).find((s) => s.stage === name)?.status || null;
}

function tierPath(stages) {
  const h = stageStatus(stages, "HEURISTICS");
  const ner = stageStatus(stages, "NER");
  const fv = stageStatus(stages, "FASTVLM");
  let path = h === "done" ? "T0" : h ? `T0(${h})` : "T0(?)";
  if (ner === "done") path += "+T1";
  else if (ner) path += `~T1(${ner})`;
  if (fv === "done") path += "+T2";
  else if (fv && fv !== "skipped") path += `~T2(${fv})`;
  return path;
}

function parseStageInfo(stages, name) {
  // Stage info is a size-capped JSON string (see v7-extension.js emit()).
  const raw = (stages || []).find((s) => s.stage === name)?.info || null;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function extractRun(result, wallMs) {
  const evidence = result.evidence || {};
  const perf = evidence.pipeline_perf || {};
  const stages = Array.isArray(perf.stages) ? perf.stages : [];
  const mem = perf.memory || {};
  const findings = Array.isArray(evidence.final_findings) ? evidence.final_findings : [];
  const scores = findings.map((f) => Number(f.score)).filter((s) => Number.isFinite(s));
  const types = {};
  for (const f of findings) {
    const t = String(f.entity || "unknown");
    types[t] = (types[t] || 0) + 1;
  }
  const memBefore = mem.before?.usedJSHeap ?? null;
  const memAfter = mem.after?.usedJSHeap ?? null;
  const device = evidence.compute_device || result.computeDevice || {};
  // Accuracy-layer fields (additive: existing latency/resource fields above
  // are untouched). findingDetails preserves text+bbox for GT matching;
  // counts come from the pipeline's own REDACT/image_redaction output.
  const ocrInfo = parseStageInfo(stages, "OCR");
  const redactInfo = parseStageInfo(stages, "REDACT");
  const decodeInfo = parseStageInfo(stages, "IMAGE_DECODE");
  const findingDetails = findings.map((f) => ({
    entity: f?.entity ?? null,
    text: typeof f?.text === "string" ? f.text.slice(0, 500) : null,
    score: Number(f?.score),
    bbox: Array.isArray(f?.bbox) && f.bbox.length === 4 ? f.bbox.map(Number) : null,
  }));
  const faceCount = Array.isArray(evidence.face_detection?.faces)
    ? evidence.face_detection.faces.length
    : findings.filter((f) => String(f?.entity || "").toUpperCase() === "FACE").length;
  // A run whose stages errored out is "degraded": it completed at the top
  // level but its timings describe a failure fast-path, not the pipeline.
  // INIT is excluded (it never emits DONE by design - see buildStagePerf).
  const degradedStages = stages
    .filter((s) => (s.status === "error" || s.status === "open") && s.stage !== "INIT")
    .map((s) => `${s.stage}(${s.status})`);
  return {
    ok: true,
    degraded: degradedStages.length > 0,
    degradedStages,
    wallMs: Math.round(wallMs),
    totalMs: typeof perf.totalTimeMs === "number" ? perf.totalTimeMs : null,
    stages: stages.map((s) => ({ stage: s.stage, status: s.status, ms: s.ms, info: s.info || null })),
    tierPath: tierPath(stages),
    tier2Fired: stageStatus(stages, "FASTVLM") === "done",
    faceDone: stageStatus(stages, "FACE") === "done",
    deviceTier: device.tier || "unknown",
    deviceLabel: device.label || device.description || "",
    memBefore,
    memAfter,
    memDelta: memBefore !== null && memAfter !== null ? memAfter - memBefore : null,
    findingCount: findings.length,
    findingTypes: types,
    scores,
    entityTypes: evidence.redaction?.entity_types_found || [],
    adjudication: evidence.redaction?.adjudication_status || null,
    fallback: evidence.fastvlm_adjudication?.fallback ?? evidence.redaction?.fallback ?? null,
    gpuEvents: Array.isArray(perf.gpuEvents) ? perf.gpuEvents.slice(0, 50) : [],
    // --- accuracy-layer record (additive; null when evidence lacks the field)
    findingDetails,
    ocrItems: typeof ocrInfo.itemsCount === "number" ? ocrInfo.itemsCount : null,
    imageWidth: typeof decodeInfo.width === "number" ? decodeInfo.width : null,
    imageHeight: typeof decodeInfo.height === "number" ? decodeInfo.height : null,
    redactTextRegions: typeof redactInfo.textRegions === "number" ? redactInfo.textRegions : null,
    redactFaceRegions: typeof redactInfo.faceRegions === "number" ? redactInfo.faceRegions : null,
    faceCount,
    redactedOcrText: typeof evidence.redaction?.redacted_ocr_text === "string"
      ? evidence.redaction.redacted_ocr_text.slice(0, 4000)
      : null,
    models: {
      ner: evidence.ner?.model ?? null,
      face: evidence.face_detection?.model ?? null,
      fastvlm: evidence.fastvlm_adjudication?.model ?? evidence.global_description?.model ?? null,
    },
  };
}

/* ---- aggregation ---- */

export function aggregateFixture(fixture, cold, steady, ctx = {}) {
  // Steady stats cover clean runs only: failed runs errored at the top
  // level, degraded runs finished on a failure fast-path (their ~3s
  // totals would otherwise masquerade as miraculous latency). Both are
  // counted and flagged, never silently averaged in.
  const ok = steady.filter((r) => r.ok && !r.degraded);
  const degraded = steady.filter((r) => r.ok && r.degraded);
  const degradedStageCounts = {};
  for (const r of degraded) for (const s of r.degradedStages) degradedStageCounts[s] = (degradedStageCounts[s] || 0) + 1;
  const totals = ok.map((r) => r.totalMs).filter((v) => typeof v === "number");
  const stageStats = summarizeStages(ok);
  const memSamp = ok.filter((r) => r.memBefore !== null && r.memAfter !== null);
  const deltas = memSamp.map((r) => r.memDelta);
  const baselines = memSamp.map((r) => r.memAfter);
  const slopeBytes = slope(memSamp.map((r, i) => ({ x: i, y: r.memAfter })));
  const slopeKB = slopeBytes === null ? null : round1(slopeBytes / 1024);
  const growthKB = memSamp.length > 1 ? round1((memSamp[memSamp.length - 1].memAfter - memSamp[0].memAfter) / 1024) : 0;
  // Robust drift: median(second half baselines) - median(first half).
  // Least-squares slope alone is fragile on n=5 with GC plunges (one
  // -26MB collection flips its sign); both must agree for a verdict.
  let driftKB = null;
  if (baselines.length >= 4) {
    const mid = Math.floor(baselines.length / 2);
    driftKB = round1((median(baselines.slice(mid)) - median(baselines.slice(0, mid))) / 1024);
  }
  let verdict = "n/a (memory sampling unavailable)";
  if (memSamp.length === 1) verdict = "single sample - no drift measurable";
  else if (memSamp.length > 1 && driftKB === null) verdict = `too few samples for drift (slope ${slopeKB}KB/run)`;
  else if (driftKB !== null) {
    verdict =
      driftKB > LEAK_TOTAL_KB && slopeKB > 0
        ? `LEAK SIGNAL - heap drifts +${driftKB}KB per half with positive slope (+${slopeKB}KB/run, +${growthKB}KB total)`
        : `stable (drift ${driftKB}KB per half, slope ${slopeKB}KB/run)`;
  }
  const scores = ok.flatMap((r) => r.scores);
  const typeHistogram = {};
  for (const r of ok) for (const [t, c] of Object.entries(r.findingTypes)) typeHistogram[t] = (typeHistogram[t] || 0) + c;
  const fallbacks = ok.filter((r) => r.fallback === true).length;
  const t2 = ok.filter((r) => r.tier2Fired).length;
  const cpuSecs = ok.map((r) => r.cpuSec).filter((v) => typeof v === "number");
  const cpuPcts = ok.map((r) => r.cpuPct).filter((v) => typeof v === "number");
  return {
    id: fixture.id,
    file: fixture.file,
    exercises: fixture.exercises,
    coldTotal: cold?.ok && !cold?.degraded ? cold.totalMs : null,
    coldNote: cold?.ok ? (cold.degraded ? `cold run degraded (${cold.degradedStages.join(", ")})` : null) : `cold run failed: ${cold?.reason || "unknown"}`,
    steadyRuns: ok.length,
    failedRuns: steady.length - ok.length - degraded.length,
    degradedRuns: degraded.length,
    degradedStages: degradedStageCounts,
    steadyTotal: summarize(totals),
    stageStats,
    memory: {
      samples: memSamp.length,
      medianBeforeMB: memSamp.length ? round1(summarize(memSamp.map((r) => r.memBefore / 1048576)).median) : null,
      medianDeltaKB: memSamp.length ? round1(summarize(deltas.map((d) => d / 1024)).median) : null,
      slopeKBPerRun: slopeKB,
      driftKBPerHalf: driftKB,
      growthKB,
      verdict,
    },
    medianFindings: summarize(ok.map((r) => r.findingCount)).median,
    entityTypes: [...new Set(ok.flatMap((r) => r.entityTypes))].sort(),
    typeHistogram,
    confidenceBands:
      scores.length > 2
        ? { p25: round1(percentile(scores, 25), 3), median: round1(percentile(scores, 50), 3), p75: round1(percentile(scores, 75), 3) }
        : null,
    fallbackSharePct: ok.length ? round1((100 * fallbacks) / ok.length) : 0,
    tier2RatePct: ok.length ? round1((100 * t2) / ok.length) : 0,
    cpuSecP50: cpuSecs.length ? summarize(cpuSecs).median : null,
    cpuPctP50: cpuPcts.length ? summarize(cpuPcts).median : null,
    // --- accuracy layer (additive; null/absent when no ground truth exists
    // for this fixture — latency/resource fields above are unaffected).
    ...buildAccuracySections(fixture, ok, ctx),
  };
}

/* Accuracy sections for one fixture: PII precision/recall/F1 (micro over
 * clean steady runs), redaction geometry/text outcomes, live visual tasks. */
function buildAccuracySections(fixture, okRuns, ctx = {}) {
  const out = {};
  const gt = ctx.groundTruth?.[fixture.id] || null;
  const gtEntities = gt?.entities || null;
  if (gtEntities) {
    const perRun = okRuns.map((r) => scoreRun(gtEntities, r.findingDetails || []));
    out.pii = {
      groundTruthFile: gt.file,
      gtRedactCount: gtEntities.filter((e) => e.action === "REDACT" && e.text).length,
      gtLeaveCount: gtEntities.filter((e) => e.action === "LEAVE").length,
      ...aggregateScores(perRun),
      byType: scoreByType(gtEntities, okRuns.map((r) => r.findingDetails || [])),
    };
    const redRuns = okRuns.map((r) =>
      evaluateRedaction(gtEntities, r.findingDetails || [], {
        imageWidth: r.imageWidth || 0,
        imageHeight: r.imageHeight || 0,
        redactedOcrText: r.redactedOcrText,
      }),
    );
    const meanOrNull = (xs) => {
      const v = xs.filter((x) => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    out.redaction = {
      groundTruthFile: gt.file,
      runs: redRuns.length,
      predictedRegionsP50: redRuns.length ? summarize(redRuns.map((x) => x.predictedRegions)).median : null,
      textCoverageMean: meanOrNull(redRuns.map((x) => x.textCoverage)),
      underRedactionMean: meanOrNull(redRuns.map((x) => x.underRedaction)),
      meanIoUMean: meanOrNull(redRuns.map((x) => x.meanIoU)),
      boxRecallAt50Mean: meanOrNull(redRuns.map((x) => x.boxRecallAt50)),
      overRedactionMean: meanOrNull(redRuns.map((x) => x.overRedaction)),
      preservationMean: meanOrNull(redRuns.map((x) => x.preservation)),
      ocrLeakMean: meanOrNull(redRuns.map((x) => x.ocrLeak)),
      ocrPreservedMean: meanOrNull(redRuns.map((x) => x.ocrPreserved)),
      redactTextRegionsP50: summarize(okRuns.map((r) => r.redactTextRegions).filter((v) => typeof v === "number")).median,
      redactFaceRegionsP50: summarize(okRuns.map((r) => r.redactFaceRegions).filter((v) => typeof v === "number")).median,
    };
    // Representative evidence (first clean steady run): before / GT / detected / redacted.
    const rep = okRuns[0] || null;
    out.redactionEvidence = rep
      ? {
        before: fixture.file,
        groundTruth: gtEntities.map((e) => e.id),
        detected: rep.findingDetails || [],
        redacted: {
          textRegions: rep.redactTextRegions,
          faceRegions: rep.redactFaceRegions,
          redactedOcrTextExcerpt: (rep.redactedOcrText || "").slice(0, 500),
        },
      }
      : null;
  }
  const liveTasks = (ctx.visualTasks || []).filter((t) => t.fixture === fixture.id && t.kind === "live");
  if (liveTasks.length) {
    const perRunPass = okRuns.map((r) => {
      const res = liveTasks.map((t) => evalLiveTask(t, r));
      const s = summarizeTasks(res);
      return { results: res, ...s };
    });
    const allRes = perRunPass.flatMap((p) => p.results);
    const byTask = {};
    for (const t of liveTasks) {
      const rs = allRes.filter((r) => r.id === t.id && !r.skipped);
      byTask[t.id] = {
        expected: t.expected,
        passRate: rs.length ? rs.filter((r) => r.pass).length / rs.length : null,
        runs: rs.length,
      };
    }
    const scored = allRes.filter((r) => !r.skipped);
    out.visualLive = {
      tasks: liveTasks.length,
      runs: okRuns.length,
      passed: scored.filter((r) => r.pass).length,
      scored: scored.length,
      accuracy: scored.length ? scored.filter((r) => r.pass).length / scored.length : null,
      byTask,
    };
  }
  return out;
}

/* ---- main flow ---- */

async function runBench(opts, inject = {}) {
  const mcpUrl = inject.mcpUrl || opts.mcpUrl;
  const prompt = inject.prompt || ask;
  const selected =
    opts.fixtures === "all"
      ? FIXTURES
      : opts.fixtures.split(",").map((s) => s.trim()).filter(Boolean).map((id) => {
          const f = FIXTURES.find((x) => x.id === id);
          if (!f) throw new Error(`unknown fixture "${id}" (known: ${FIXTURES.map((x) => x.id).join(", ")})`);
          return f;
        });

  // 1. Preflight: daemon up? extension paired (proven by a live list_tabs)?
  let health;
  try {
    health = await checkHealth(opts.healthUrl);
  } catch (err) {
    throw new Error(`PREFLIGHT FAILED - ${err.message}`);
  }
  let tabs;
  try {
    tabs = await listTabs(mcpUrl);
  } catch (err) {
    throw new Error(
      `PREFLIGHT FAILED - list_tabs did not answer (${err.message}). ` +
        `The extension must be loaded AND paired: check the daemon dashboard for paired clients (health says pairedClients=${health?.pairedClients ?? "?"}).`,
    );
  }
  console.log(`preflight ok - daemon up (pairedClients=${health?.pairedClients ?? "?"}), list_tabs answered (${tabs.length} tab(s)).`);

  // 2. Fixture server (ephemeral port when --port 0), unless the caller
  // serves fixtures themselves via --fixture-base.
  let server = null;
  let base = (opts.fixtureBase || "").replace(/\/+$/, "");
  if (!base) {
    server = await startFixtureServer(opts.fixturesRoot, opts.port);
    const boundPort = server.address()?.port || opts.port;
    base = `http://127.0.0.1:${boundPort}`;
  }
  console.log(`fixtures at ${base}/ (serving from ${opts.fixtureBase ? "external server" : opts.fixturesRoot})`);

  const deviceSeen = new Set();
  const fixtureResults = [];
  const flags = [];
  let aborted = null;
  try {
    for (const [fi, fixture] of selected.entries()) {
      const url = `${base}/${fixture.file}`;
      console.log(`\n[${fi + 1}/${selected.length}] fixture "${fixture.id}" - ${fixture.exercises}`);
      console.log(`  open ${url} and make it the ACTIVE tab.`);
      await inject.onFixture?.(fixture, base);
      if (!opts.yes) await prompt("  press Enter when the fixture tab is active...");

      // Verify the active tab really is this fixture (never time the wrong page).
      const live = await listTabs(mcpUrl).catch((err) => {
        throw new Error(`list_tabs failed before fixture "${fixture.id}": ${err.message} - extension may have unpaired mid-run.`);
      });
      const active = live.find((t) => t.active);
      if (!active || !String(active.url || "").includes(fixture.file)) {
        throw new Error(
          `WRONG TAB - expected the active tab to be ${fixture.file} but it is "${active?.url || "(none active)"}". ` +
            `Activate the fixture tab and re-run with --fixtures=${fixture.id}.`,
        );
      }
      console.log(`  active tab verified: ${active.url}`);

      const runOne = async (label) => {
        const t0 = Date.now();
        const cpuBefore = await sampleChromeCpuSeconds().catch(() => null);
        try {
          const toolArgs = opts.recycleAfter === null ? {} : { recycleAfterCaptures: opts.recycleAfter };
          const res = await callTool(mcpUrl, "capture_tab", toolArgs, opts.timeoutMs);
          const rec = extractRun(res, Date.now() - t0);
          const cpuAfter = await sampleChromeCpuSeconds().catch(() => null);
          if (cpuBefore !== null && cpuAfter !== null && rec.wallMs > 0) {
            rec.cpuSec = round1(cpuAfter - cpuBefore);
            rec.cpuPct = round1(((cpuAfter - cpuBefore) / (rec.wallMs / 1000)) * 100);
          } else {
            rec.cpuSec = null;
            rec.cpuPct = null;
          }
          if (rec.deviceTier) deviceSeen.add(`${rec.deviceTier}${rec.deviceLabel ? ` (${rec.deviceLabel})` : ""}`);
          console.log(`  ${label}: total=${rec.totalMs}ms tiers=${rec.tierPath} findings=${rec.findingCount} heapdelta=${rec.memDelta === null ? "n/a" : Math.round(rec.memDelta / 1024) + "KB"}`);
          return rec;
        } catch (err) {
          console.log(`  ${label}: FAILED - ${err.message}`);
          return { ok: false, reason: err.message };
        }
      };

      const cold = await runOne("cold (run 1, warm-up - excluded from steady stats)");
      const steady = [];
      let consecutiveFailures = cold.ok ? 0 : 1;
      for (let i = 0; i < opts.runs; i++) {
        if (opts.gapMs) await new Promise((r) => setTimeout(r, opts.gapMs));
        const rec = await runOne(`run ${i + 1}/${opts.runs}`);
        steady.push(rec);
        consecutiveFailures = rec.ok ? 0 : consecutiveFailures + 1;
        if (consecutiveFailures >= 3) {
          // Keep the partial fixture so completed runs are not lost.
          fixtureResults.push({ fixture, cold, steady });
          throw new Error(
            `ABORTING - 3 consecutive capture failures (last: ${rec.reason}). ` +
              `Likely causes: (a) the extension unpaired or the daemon died - re-pair and re-run; ` +
              `(b) a cold run exceeded the daemon's tool ceiling while models loaded - restart the daemon with ` +
              `PERSCOPE_TOOL_TIMEOUT_MS=600000, wait ~60s for the stuck pipeline to release, then re-run.`,
          );
        }
      }
      fixtureResults.push({ fixture, cold, steady });
    }
  } catch (err) {
    // Aborted mid-suite (wrong tab, consecutive failures, lost pairing):
    // keep whatever completed and still write partial outputs below.
    aborted = err.message;
    console.log(`\nABORTED - ${err.message}`);
  } finally {
    if (server) server.close();
  }

  // 3. Aggregate (partial when aborted - never lose completed runs again).
  // Accuracy context (additive): ground truth + visual tasks loaded once;
  // a missing/unreadable dir degrades to "no accuracy sections", never a failure.
  const groundTruth = loadGroundTruth(inject.groundTruthDir || opts.groundTruthDir || DEFAULT_GROUND_TRUTH_DIR);
  const visualTasks = loadVisualTasks(inject.groundTruthDir || opts.groundTruthDir || DEFAULT_GROUND_TRUTH_DIR);
  const fixtureSources = {};
  for (const { fixture } of fixtureResults) {
    try {
      fixtureSources[fixture.id] = fs.readFileSync(path.join(opts.fixturesRoot, fixture.file), "utf8");
    } catch { /* static tasks for this fixture are skipped, live tasks unaffected */ }
  }
  const visualStatic = visualTasks
    .filter((t) => t.kind === "static")
    .map((t) => {
      const src = fixtureSources[t.fixture];
      if (src === undefined) return { ...t, actual: "FIXTURE_SOURCE_MISSING", pass: false, evidence: "static:unreadable", skipped: true };
      return evalStaticTask(t, src);
    });
  const ctx = { groundTruth, visualTasks };
  const agg = fixtureResults.map(({ fixture, cold, steady }) => aggregateFixture(fixture, cold, steady, ctx));
  const allSteady = fixtureResults.flatMap(({ steady }) => steady.filter((r) => r.ok));
  const allStages = summarizeStages(allSteady);
  const allTotals = summarize(allSteady.map((r) => r.totalMs).filter((v) => typeof v === "number"));
  const tierPaths = {};
  let tier2Runs = 0;
  for (const r of allSteady) {
    tierPaths[r.tierPath] = (tierPaths[r.tierPath] || 0) + 1;
    if (r.tier2Fired) tier2Runs++;
  }
  // Suite-level accuracy rollups (micro over fixtures with ground truth).
  const piiScores = [];
  for (const { fixture, steady } of fixtureResults) {
    const gt = groundTruth[fixture.id];
    if (!gt) continue;
    for (const r of steady.filter((x) => x.ok && !x.degraded)) {
      piiScores.push(scoreRun(gt.entities, r.findingDetails || []));
    }
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
  const visualLiveAll = agg.flatMap((f) =>
    Object.entries(f.visualLive?.byTask || {}).map(([id, v]) => ({ id, ...v })),
  );
  const visualLiveScored = agg.reduce((a, f) => a + (f.visualLive?.scored || 0), 0);
  const visualLivePassed = agg.reduce((a, f) => a + (f.visualLive?.passed || 0), 0);
  const visualOverall = {
    static: visualStaticSummary,
    staticResults: visualStatic,
    live: {
      scored: visualLiveScored,
      passed: visualLivePassed,
      accuracy: visualLiveScored ? visualLivePassed / visualLiveScored : null,
      byTask: visualLiveAll,
    },
  };
  const modelsSeen = {};
  for (const r of allSteady) {
    for (const [k, v] of Object.entries(r.models || {})) {
      if (typeof v === "string" && v) modelsSeen[k] = modelsSeen[k] || new Set();
    }
  }
  for (const r of allSteady) {
    for (const [k, v] of Object.entries(r.models || {})) {
      if (typeof v === "string" && v) modelsSeen[k].add(v);
    }
  }
  const models = Object.fromEntries(Object.entries(modelsSeen).map(([k, s]) => [k, [...s]]));
  const failedTotal = agg.reduce((a, f) => a + (f.failedRuns || 0), 0);
  const degradedTotal = agg.reduce((a, f) => a + (f.degradedRuns || 0), 0);
  for (const f of agg) {
    if (f.failedRuns) flags.push(`${f.failedRuns} steady run(s) failed on fixture "${f.id}" (see raw JSON for reasons).`);
    if (f.degradedRuns) {
      const which = Object.entries(f.degradedStages).map(([s, c]) => `${s}x${c}`).join(", ");
      flags.push(`${f.degradedRuns} steady run(s) DEGRADED on "${f.id}" (${which}) - excluded from latency stats; timings describe the failure path, not the pipeline.`);
    }
    if (f.coldNote) flags.push(`cold-start anomaly on "${f.id}": ${f.coldNote}.`);
    if (f.memory.samples === 0) flags.push(`no memory samples on "${f.id}" - performance.memory unavailable in the offscreen context?`);
    if (String(f.memory.verdict).startsWith("LEAK SIGNAL")) flags.push(`${f.id}: ${f.memory.verdict}.`);
  }
  const gpuEventRuns = allSteady.filter((r) => Array.isArray(r.gpuEvents) && r.gpuEvents.length > 0).length;
  if (gpuEventRuns) {
    flags.push(`GPU EVENTS - ${gpuEventRuns}/${allSteady.length} runs logged WebGPU uncapturederror/device-lost events (see raw JSON gpuEvents per run). Correlate with degraded runs for the Phase 3 leak investigation.`);
  }
  const runsMissingStages = allSteady.filter((r) => !Array.isArray(r.stages) || r.stages.length === 0).length;
  if (allSteady.length && runsMissingStages) {
    flags.push(
      `INSTRUMENTATION MISSING - ${runsMissingStages}/${allSteady.length} runs returned no pipeline_perf.stages. ` +
        `The loaded extension predates the benchmark instrumentation: reload it from extension/v7 beta/dist/ and re-run.`,
    );
  }
  const clean = agg.find((f) => f.id === "clean");
  if (clean && clean.tier2RatePct > 0) {
    flags.push(`clean fixture fired Tier 2 at ${clean.tier2RatePct}% - by construction it should be ~0% (text-free page). Investigate before trusting escalation numbers.`);
  }
  const ambiguous = agg.find((f) => f.id === "ambiguous");
  if (ambiguous && ambiguous.steadyRuns > 0 && ambiguous.tier2RatePct < 50) {
    flags.push(`ambiguous fixture fired Tier 2 at only ${ambiguous.tier2RatePct}% - it is designed to force adjudication; fixture or threshold needs review.`);
  }

  const summary = {
    date: new Date().toISOString(),
    commit: gitCommit(),
    device: [...deviceSeen].join("; ") || "unknown",
    deviceDetail: "record-only: per-run device forcing is not possible via bridge (offscreen passes options:{})",
    runsPerFixture: opts.runs,
    mcpUrl,
    fixtureBase: base + "/",
    fixtures: agg,
    stageStats: allStages,
    totalStats: allTotals,
    totalRuns: allSteady.length,
    tier2Runs,
    escalationRatePct: allSteady.length ? round1((100 * tier2Runs) / allSteady.length) : 0,
    tierPaths,
    failedRuns: failedTotal,
    degradedRuns: degradedTotal,
    failureRatePct: allSteady.length + failedTotal + degradedTotal
      ? round1((100 * (failedTotal + degradedTotal)) / (allSteady.length + failedTotal + degradedTotal))
      : 0,
    memoryNote:
      "Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). " +
      "A rising post-run baseline across identical runs is the leak signal - slope >256KB/run with >1MB total growth flags it.",
    flags,
    // --- accuracy + environment layer (additive; null = NOT MEASURED, never guessed)
    env: collectEnv(),
    models,
    groundTruth: {
      dir: "benchmarks/ground_truth",
      fixtures: Object.fromEntries(
        Object.entries(groundTruth).map(([id, g]) => [id, { file: g.file, entities: g.entities.length }]),
      ),
    },
    piiOverall,
    redactionOverall,
    visualOverall,
  };

  const payload = { summary, runs: fixtureResults };
  if (aborted) {
    payload.aborted = aborted;
    summary.flags.unshift(`RUN ABORTED MID-SUITE - ${aborted} (outputs below cover completed runs only).`);
  }
  const jsonFile = writeResults(opts.resultsDir, payload);
  fs.writeFileSync(opts.latestFile, renderLatestMd(summary));
  console.log(`\nwrote ${jsonFile}\nwrote ${opts.latestFile}`);
  console.log(`\nescalation rate (Tier 2): ${summary.escalationRatePct}% * steady runs: ${summary.totalRuns} * flags: ${flags.length}`);
  for (const fl of flags) console.log(`  [!] ${fl}`);
  if (aborted) throw new Error(aborted);
  return { jsonFile, latestFile: opts.latestFile, summary };
}

/* ---- self-test: full plumbing against an in-process stub bridge ---- */

async function selfTest() {
  const assert = (await import("node:assert/strict")).default;
  const { mean, median, percentile, slope, summarize } = await import("./lib/stats.mjs");
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.ok(Math.abs(slope([{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }]) - 2) < 1e-9);
  assert.equal(summarize([]).n, 0);
  console.log("stats unit checks passed.");

  // Accuracy-layer unit checks (pure modules, no bridge needed).
  const acc = await import("./lib/accuracy.mjs");
  const red = await import("./lib/redaction.mjs");
  const vis = await import("./lib/visual-tasks.mjs");
  assert.equal(acc.normalizeText("Jeet Dot Routh At Gmail"), "jeet.routh@gmail");
  assert.ok(acc.textMatch("WBSC0LM1234", "ifsc looks like WBSC0LM1234 verify"));
  assert.ok(!acc.textMatch("3524", "no digits here"));
  assert.ok(acc.typeCompatible("PERSON_NAME", "first_name"));
  assert.ok(!acc.typeCompatible("EMAIL", "PHONE"));
  {
    const gt = [
      { id: "g1", entity_type: "EMAIL", text: "arjun.mehta@acme-invoice.test", action: "REDACT" },
      { id: "g2", entity_type: "PHONE", text: "+91-98765-43210", action: "REDACT" },
      { id: "g3", entity_type: "DECOY", text: "support@example.com", action: "LEAVE" },
    ];
    const s = acc.scoreRun(gt, [
      { entity: "EMAIL", text: "contact arjun.mehta@acme-invoice.test today" },
      { entity: "DECOY", text: "support@example.com" },
    ]);
    assert.deepEqual([s.tp, s.fp, s.fn], [1, 1, 1]);
    assert.equal(s.overRedact, 1);
    const p = acc.prf(1, 1, 1);
    assert.ok(Math.abs(p.precision - 0.5) < 1e-9 && Math.abs(p.recall - 0.5) < 1e-9);
    assert.deepEqual(acc.prf(0, 0, 0), { precision: null, recall: null, f1: null });
  }
  assert.ok(Math.abs(red.boxIoU([0, 0, 10, 10], [5, 5, 15, 15]) - (25 / 175)) < 1e-9);
  assert.equal(red.boxIoU([0, 0, 1, 1], [2, 2, 3, 3]), 0);
  assert.deepEqual(red.clampRegion([5, 5, 50, 20], 100, 100, 2), [3, 3, 52, 22]);
  {
    // Parity spot-check: local mirror matches the real canvas-redactor.js helpers.
    const { pathToFileURL } = await import("node:url");
    const real = await import(pathToFileURL(path.join(REPO_ROOT, "extension/v7 beta/src/pipeline/canvas-redactor.js")).href);
    assert.deepEqual(real.clampBBox([5, 5, 50, 20], 100, 100, 2), { left: 3, top: 3, width: 49, height: 19, bbox: [3, 3, 52, 22] });
    assert.deepEqual(red.clampRegion([5, 5, 50, 20], 100, 100, 2), [3, 3, 52, 22]);
    assert.equal(real.uniqueRedactionRegions([{ bbox: [1, 1, 5, 5] }, { bbox: [1, 1, 5, 5] }]).length, 1);
    assert.equal(red.dedupRegions([{ bbox: [1, 1, 5, 5] }, { bbox: [1, 1, 5, 5] }]).length, 1);
  }
  {
    const r = red.evaluateRedaction(
      [
        { id: "g1", entity_type: "EMAIL", text: "secret@acme-invoice.test", action: "REDACT", bbox: null },
        { id: "g2", entity_type: "DECOY", text: "public note", action: "LEAVE", bbox: null },
      ],
      [{ entity: "EMAIL", text: "mail secret@acme-invoice.test", bbox: [0, 0, 10, 10] }],
      { imageWidth: 100, imageHeight: 100, redactedOcrText: "mail [REDACTED:EMAIL] public note" },
    );
    assert.equal(r.textCoverage, 1);
    assert.equal(r.meanIoU, null); // no GT boxes -> null, never 0-filled
    assert.equal(r.preservation, 1);
    assert.equal(r.ocrLeak, 0);
  }
  {
    const t = vis.evalStaticTask({ id: "x", fixture: "f", check: "li-count", expected: 2 }, "<ul><li>a</li><li>b</li></ul>");
    assert.equal(t.pass, true);
    const l = vis.evalLiveTask({ id: "y", fixture: "f", check: "tier2-fired", expected: true }, { tier2Fired: true });
    assert.equal(l.pass, true);
  }
  console.log("accuracy unit checks passed (accuracy/redaction/visual-tasks + canvas-redactor parity).");

  // Stub MCP server: canned capture_tab with realistic evidence shape.
  const http = await import("node:http");
  const state = { activeUrl: "" };
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/health") {
        res.end(JSON.stringify({ ok: true, pairedClients: 1, clients: [{ clientId: "stub-ext", role: "extension" }] }));
        return;
      }
      let msg = {};
      try {
        msg = JSON.parse(body);
      } catch { /* fall through */ }
      const reply = (result) => ({ jsonrpc: "2.0", id: msg.id || 1, result });
      if (msg.method === "tools/list") {
        res.end(JSON.stringify(reply({ tools: [{ name: "capture_tab" }, { name: "list_tabs" }] })));
      } else if (msg.method === "tools/call" && msg.params?.name === "list_tabs") {
        res.end(
          JSON.stringify(
            reply({ content: [{ type: "text", text: JSON.stringify({ tabs: [{ tabId: 9, title: "stub", url: state.activeUrl, active: true }] }) }] }),
          ),
        );
      } else if (msg.method === "tools/call" && msg.params?.name === "capture_tab") {
        calls++;
        const heap = 50_000_000 + calls * 3000;
        res.end(
          JSON.stringify(
            reply({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "ok",
                    totalTimeMs: 1200 + calls * 5,
                    computeDevice: { tier: "cpu", label: "stub" },
                    evidence: {
                      compute_device: { tier: "cpu", label: "stub" },
                      image: { width: 1600, height: 900 },
                      final_findings: [
                        { entity: "PERSON_NAME", text: "Eleanor Rigby", score: 0.97, bbox: [100, 200, 300, 230] },
                        { entity: "PHONE", text: "+1-555-014-2288", score: 0.81, bbox: [100, 240, 350, 270] },
                      ],
                      face_detection: { model: "garavv/blazeface-onnx", faces: [], count: 0 },
                      ner: { model: "models/ettin-68m-nemotron-pii-onnx" },
                      fastvlm_adjudication: { model: "onnx-community/FastVLM-0.5B-ONNX", fallback: false },
                      redaction: {
                        entity_types_found: ["PERSON_NAME", "PHONE"],
                        adjudication_status: "complete",
                        redacted_ocr_text: "Billed to [REDACTED:PERSON_NAME] call [REDACTED:PHONE] fictitious",
                      },
                      pipeline_perf: {
                        totalTimeMs: 1200 + calls * 5,
                        stages: [
                          { stage: "DEVICE", status: "done", ms: 4 },
                          { stage: "IMAGE_DECODE", status: "done", ms: 30, info: "{\"width\":1600,\"height\":900}" },
                          { stage: "FACE", status: "done", ms: 120 },
                          { stage: "OCR", status: "done", ms: 400, info: "{\"itemsCount\":20}" },
                          { stage: "NER", status: "done", ms: 250 },
                          { stage: "HEURISTICS", status: "done", ms: 40 },
                          { stage: "FASTVLM", status: "done", ms: 300 },
                          { stage: "REDACT", status: "done", ms: 56, info: "{\"textRegions\":2,\"faceRegions\":0}" },
                        ],
                        memory: { before: { usedJSHeap: heap - 500_000 }, after: { usedJSHeap: heap } },
                      },
                    },
                  }),
                },
              ],
            }),
          ),
        );
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id || 1, error: { message: "stub: unknown call" } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const stubPort = server.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bench-selftest-"));

  const out = await runBench(
    {
      runs: 2,
      fixtures: "clean,text-heavy",
      port: 0,
      mcpUrl: `http://127.0.0.1:${stubPort}/mcp`,
      healthUrl: `http://127.0.0.1:${stubPort}/health`,
      timeoutMs: 15_000,
      gapMs: 0,
      yes: true,
      recycleAfter: null,
      fixturesRoot: DEFAULT_FIXTURES_ROOT,
      resultsDir: path.join(tmp, "results"),
      latestFile: path.join(tmp, "latest.md"),
    },
    {
      mcpUrl: `http://127.0.0.1:${stubPort}/mcp`,
      // The stub has no tabs: mirror the fixture-under-test as the
      // "active tab" so the verify step exercises its real path.
      onFixture: (fixture, base) => {
        state.activeUrl = `${base}/${fixture.file}`;
      },
    },
  ).catch((err) => ({ error: err.message }));
  server.close();
  if (out.error) throw new Error(`self-test run failed: ${out.error}`);
  assert.ok(fs.existsSync(out.jsonFile), "results json written");
  assert.ok(fs.existsSync(out.latestFile), "latest.md written");
  const md = fs.readFileSync(out.latestFile, "utf8");
  assert.ok(md.includes("clean") && md.includes("text-heavy"), "latest.md covers fixtures");
  assert.equal(out.summary.totalRuns, 4, "2 fixtures x 2 steady runs");
  assert.equal(out.summary.escalationRatePct, 100, "stub fires Tier 2 every run");
  // Accuracy layer end-to-end: stub findings carry Eleanor Rigby + phone text,
  // so text-heavy scores TP>=2 while clean (empty GT) records them as FP-only.
  const th = out.summary.fixtures.find((f) => f.id === "text-heavy");
  assert.ok(th?.pii, "text-heavy has pii section (ground truth loaded)");
  assert.ok(th.pii.tp >= 2, `stub findings match text-heavy GT (tp=${th.pii.tp})`);
  assert.ok(th.redaction && th.redaction.textCoverageMean !== null, "redaction coverage measured");
  assert.ok(th.redaction.predictedRegionsP50 === 2, "predicted regions mirror canvas-redactor dedup");
  assert.ok(md.includes("PII detection accuracy"), "latest.md exposes PII accuracy");
  assert.ok(md.includes("Redaction evaluation"), "latest.md exposes redaction evaluation");
  assert.ok(md.includes("Visual-context tasks"), "latest.md exposes visual tasks");
  assert.ok(out.summary.env?.node, "env captured");
  assert.ok(out.summary.visualOverall?.static?.scored > 0, "static visual tasks evaluated");
  console.log("self-test passed (plumbing + accuracy layers end-to-end against stub bridge).");
}

const isMainModule = (() => {
  try {
    const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
    return entry !== null && import.meta.url === entry;
  } catch {
    return false;
  }
})();
if (!isMainModule) {
  console.error("benchmarks/run.mjs imported as a module - aggregation functions available, no run launched.");
} else {
// NOTE: never process.exit() here - on Windows/Node 24 exiting with live
// fetch-pool handles trips a UV assertion. Setting exitCode lets the loop
// drain instead.
const opts = parseArgs(process.argv.slice(2));
if (opts.selfTest) {
  selfTest().then(
    () => {},
    (err) => {
      console.error(`SELF-TEST FAILED - ${err.message}`);
      process.exitCode = 1;
    },
  );
} else {
  runBench(opts).then(
    () => {},
    (err) => {
      console.error(`BENCHMARK FAILED - ${err.message}`);
      process.exitCode = 1;
    },
  );
}
}
