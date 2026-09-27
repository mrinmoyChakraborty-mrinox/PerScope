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
import { execSync } from "node:child_process";
import { checkHealth, callTool, listTabs, DEFAULT_MCP_URL, DEFAULT_HEALTH_URL } from "./lib/mcp-client.mjs";
import { startFixtureServer } from "./lib/serve.mjs";
import { summarize, summarizeStages, slope, percentile, round1 } from "./lib/stats.mjs";
import { writeResults, renderLatestMd, stampName } from "./lib/report.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO_ROOT = path.resolve(HERE, "..");
const DEFAULT_FIXTURES_ROOT = path.join(HERE, "fixtures");
const DEFAULT_RESULTS_DIR = path.join(HERE, "results");
const DEFAULT_LATEST_FILE = path.join(HERE, "latest.md");
const DEFAULT_PORT = 7341;

export const FIXTURES = [
  { id: "text-heavy", file: "text-heavy.html", exercises: "dense synthetic PII text; full T0+T1+T2 path" },
  { id: "document", file: "document.html", exercises: "scanned-document image with photo + print; OCR-on-image + face" },
  { id: "face", file: "face.html", exercises: "large ID photo + sparse text; face-detection exercise" },
  { id: "clean", file: "clean.html", exercises: "zero rendered text; best-case fast path, Tier 2 must skip" },
  { id: "ambiguous", file: "ambiguous.html", exercises: "masked/partial PII strings; forces Tier 2 adjudication" },
];

const LEAK_SLOPE_KB_PER_RUN = 256;
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
    fixturesRoot: DEFAULT_FIXTURES_ROOT,
    resultsDir: DEFAULT_RESULTS_DIR,
    latestFile: DEFAULT_LATEST_FILE,
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
    else if (key === "--fixtures-root") out.fixturesRoot = v;
    else if (key === "--results-dir") out.resultsDir = v;
    else if (key === "--latest-file") out.latestFile = v;
    else if (key === "--yes") out.yes = true;
    else if (key === "--self-test") out.selfTest = true;
    else if (key === "--help" || key === "-h") {
      console.log(
        `usage: npm run benchmark -- [--runs=20] [--fixtures=all|id,...] [--port=7341]\n` +
          `  [--mcp-url=...] [--timeout-ms=600000] [--gap-ms=2000] [--yes]\n` +
          `  [--fixtures-root=...] [--results-dir=...] [--latest-file=...] [--self-test]`,
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
  return {
    ok: true,
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
  };
}

/* ---- aggregation ---- */

function aggregateFixture(fixture, cold, steady) {
  const ok = steady.filter((r) => r.ok);
  const totals = ok.map((r) => r.totalMs).filter((v) => typeof v === "number");
  const stageStats = summarizeStages(ok);
  const memSamp = ok.filter((r) => r.memBefore !== null && r.memAfter !== null);
  const deltas = memSamp.map((r) => r.memDelta);
  const slopeBytes = slope(memSamp.map((r, i) => ({ x: i, y: r.memAfter })));
  const slopeKB = slopeBytes === null ? null : round1(slopeBytes / 1024);
  const growthKB = memSamp.length > 1 ? round1((memSamp[memSamp.length - 1].memAfter - memSamp[0].memAfter) / 1024) : 0;
  let verdict = "n/a (memory sampling unavailable)";
  if (memSamp.length > 1) {
    verdict =
      slopeKB > LEAK_SLOPE_KB_PER_RUN && growthKB > LEAK_TOTAL_KB
        ? `LEAK SIGNAL - heap grows ~${slopeKB}KB/run (+${growthKB}KB total)`
        : `stable (slope ${slopeKB}KB/run)`;
  } else if (memSamp.length === 1) verdict = "single sample - no drift measurable";
  const scores = ok.flatMap((r) => r.scores);
  const typeHistogram = {};
  for (const r of ok) for (const [t, c] of Object.entries(r.findingTypes)) typeHistogram[t] = (typeHistogram[t] || 0) + c;
  const fallbacks = ok.filter((r) => r.fallback === true).length;
  const t2 = ok.filter((r) => r.tier2Fired).length;
  return {
    id: fixture.id,
    file: fixture.file,
    exercises: fixture.exercises,
    coldTotal: cold?.ok ? cold.totalMs : null,
    coldNote: cold?.ok ? null : `cold run failed: ${cold?.reason || "unknown"}`,
    steadyRuns: ok.length,
    failedRuns: steady.length - ok.length,
    steadyTotal: summarize(totals),
    stageStats,
    memory: {
      samples: memSamp.length,
      medianBeforeMB: memSamp.length ? round1(summarize(memSamp.map((r) => r.memBefore / 1048576)).median) : null,
      medianDeltaKB: memSamp.length ? round1(summarize(deltas.map((d) => d / 1024)).median) : null,
      slopeKBPerRun: slopeKB,
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
  };
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
        try {
          const res = await callTool(mcpUrl, "capture_tab", {}, opts.timeoutMs);
          const rec = extractRun(res, Date.now() - t0);
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
  const agg = fixtureResults.map(({ fixture, cold, steady }) => aggregateFixture(fixture, cold, steady));
  const allSteady = fixtureResults.flatMap(({ steady }) => steady.filter((r) => r.ok));
  const allStages = summarizeStages(allSteady);
  const allTotals = summarize(allSteady.map((r) => r.totalMs).filter((v) => typeof v === "number"));
  const tierPaths = {};
  let tier2Runs = 0;
  for (const r of allSteady) {
    tierPaths[r.tierPath] = (tierPaths[r.tierPath] || 0) + 1;
    if (r.tier2Fired) tier2Runs++;
  }
  for (const f of agg) {
    if (f.failedRuns) flags.push(`${f.failedRuns} steady run(s) failed on fixture "${f.id}" (see raw JSON for reasons).`);
    if (f.coldNote) flags.push(`cold-start anomaly on "${f.id}": ${f.coldNote}.`);
    if (f.memory.samples === 0) flags.push(`no memory samples on "${f.id}" - performance.memory unavailable in the offscreen context?`);
    if (String(f.memory.verdict).startsWith("LEAK SIGNAL")) flags.push(`${f.id}: ${f.memory.verdict}.`);
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
    memoryNote:
      "Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). " +
      "A rising post-run baseline across identical runs is the leak signal - slope >256KB/run with >1MB total growth flags it.",
    flags,
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
                      final_findings: [{ entity: "EMAIL", score: 0.97 }, { entity: "PHONE", score: 0.81 }],
                      redaction: { entity_types_found: ["EMAIL", "PHONE"], adjudication_status: "complete" },
                      fastvlm_adjudication: { fallback: false },
                      pipeline_perf: {
                        totalTimeMs: 1200 + calls * 5,
                        stages: [
                          { stage: "DEVICE", status: "done", ms: 4 },
                          { stage: "IMAGE_DECODE", status: "done", ms: 30 },
                          { stage: "FACE", status: "done", ms: 120 },
                          { stage: "OCR", status: "done", ms: 400 },
                          { stage: "NER", status: "done", ms: 250 },
                          { stage: "HEURISTICS", status: "done", ms: 40 },
                          { stage: "FASTVLM", status: "done", ms: 300 },
                          { stage: "REDACT", status: "done", ms: 56 },
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
  console.log("self-test passed (plumbing end-to-end against stub bridge).");
}

const opts = parseArgs(process.argv.slice(2));
// NOTE: never process.exit() here - on Windows/Node 24 exiting with live
// fetch-pool handles trips a UV assertion. Setting exitCode lets the loop
// drain instead.
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
