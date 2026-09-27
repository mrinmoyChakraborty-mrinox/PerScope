# PerScope benchmark harness

Standalone latency / memory / tier-escalation / accuracy-proxy benchmarking,
driven through the bridge exactly like an MCP agent: `capture_tab` over
MCP-over-HTTP, fixtures served locally, guided active-tab flow.

## Bring-up order (same as everything else in this project)

1. **Bridge daemon running.** `bridge/bin/cli.js daemon`.
   Raise the tool ceiling for bench sessions — cold model loads exceed the
   60s default: `PERSCOPE_TOOL_TIMEOUT_MS=600000 bridge/bin/cli.js daemon`.
2. **Extension loaded + paired — from current `dist/`.** The benchmark
   reads per-stage timings the stock build does not emit, so reload the
   extension at `chrome://extensions` after rebuilding
   (`node build.mjs` in `extension/v7 beta`). Pair once via the dashboard;
   the token persists, so refreshes re-pair silently. If results flag
   `INSTRUMENTATION MISSING`, the loaded build predates the harness.
3. **Fixture server (its own terminal, keep running):**
   `node benchmarks/serve-fixtures.mjs [--port=7341]`
4. **From the repo root:** `npm run benchmark`

The harness fails loudly (no silent hangs) when the daemon is down, the
extension is unpaired, the wrong tab is active, or 3 captures fail in a row.

## Flags

```
--runs=20            steady runs per fixture (plus 1 cold-start run, reported separately)
--fixtures=all       or comma list: text-heavy,document,face,clean,ambiguous
--port=7341          fixture server port (probed before bind; 0 = ephemeral)
--mcp-url=…          default http://127.0.0.1:7332/mcp
--timeout-ms=600000  per-capture ceiling (raise with the daemon value above)
--gap-ms=2000        settle delay between runs
--yes                skip the open-tab prompts (still verifies the active tab)
--self-test          full plumbing run against an in-process stub bridge (no daemon needed)
```

## Fixtures (`fixtures/`)

| id | file | designed to exercise | tier expectation |
|---|---|---|---|
| text-heavy | text-heavy.html | dense synthetic PII (invoice) | T0+T1+T2 |
| document | document.html | scanned-doc photo w/ print + ID photo (`img/doc-face.jpg`) | T0+T1+T2 + face |
| face | face.html | large ID photo + sparse text | T0+T1+T2 + face |
| clean | clean.html | **zero rendered text** (CSS shapes only) | T0+T1, Tier 2 must skip (~0%) |
| ambiguous | ambiguous.html | masked/partial PII strings | forces Tier 2 (~100%) |

All PII is synthetic and fictitious — except `img/doc-face.jpg`, which is a
copy of repo-root `s1.jpg` (a sample certificate, reused so the document and
face fixtures exercise a real photo + real print). Localhost-only, never
uploaded anywhere.

Why the clean fixture is text-free: FastVLM's skip condition is
`candidates>0 OR ocr items>0`, so *any* rendered text fires Tier 2. A clean
page with text would measure T2, not the fast path — hence CSS shapes only
(`<title>` is metadata, invisible to OCR).

## What each run records

Per `capture_tab`: `pipeline_perf.totalTimeMs`, per-stage `{stage, status, ms}`
(DEVICE, IMAGE_DECODE, FACE, OCR, NER, HEURISTICS, FASTVLM, REDACT),
`performance.memory` before/after (offscreen heap), `compute_device`,
finding counts/types/scores, adjudication status + fallback flag.
Client-measured wall time is recorded alongside but never mixed into stats.

## Outputs

- `results/<timestamp>.json` — full raw data (git-ignored).
- `latest.md` — tracked summary: stage latency stats, cold-vs-steady table,
  memory deltas + drift verdicts, escalation rate, per-fixture breakdown,
  accuracy proxies, flags. Diff it across commits.

## Metric honesty notes

- **No precision/recall**: no labeled ground truth exists. Proxies only
  (counts, type histograms, confidence bands) - the baseline to diff against
  once labeled fixtures exist. Follow-up: span-level labeled fixtures.
- **Open measurement question (2026-09-27): OCR brackets at ~0ms** while
  downstream stages demonstrably consume OCR text (NER finds entities,
  FastVLM fires). Stage sums reconcile with totals, so the hook is pairing
  correctly - the sub-ms figure is what the pipeline's own marks report.
  Each stage record now carries a size-capped `info` payload (e.g. OCR
  `itemsCount`) so work-done vs time-spent can be cross-checked per run;
  treat per-stage OCR/NER-clean numbers as provisional until this resolves.
  Headline metrics (totals, escalation share, memory drift) are unaffected.
- **Cold vs steady are separate numbers** and reported separately; run 1 per
  fixture is warm-up (model loads) and excluded from steady stats. Note that
  "cold" means first capture of the bench session, not cold models - module
  caches persist in a long-lived offscreen document.
- **Leak rule**: post-run heap slope >256KB/run with >1MB total growth over
  steady runs => `LEAK SIGNAL`. Verified by deliberate injection (see history).
- **Device is record-only**: the bridge capture path passes `options:{}`,
  so per-run WebGPU/WASM forcing is impossible - cross-device comparison is
  a follow-up, flagged not worked around.
- **Active-tab-only**: `capture_tab` rejects `tabId` (beta scope), so each
  fixture batch needs its tab activated by hand; `list_tabs` verifies before
  timing starts.
