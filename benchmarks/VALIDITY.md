# PerScope benchmark — validity statement (official live baseline)

Bench commit: `43bed93` **plus uncommitted extension changes** (heuristics,
safety, prompts, offscreen — all built into `extension/v7 beta/dist/` before
the session; `dist/offscreen.js` contains the benchmark instrumentation and is
newer than `src/`). Official baseline:
`benchmarks/results/official-baseline-2026-09-28_23-37-36.json`, aggregated
with `benchmarks/combine-baseline.mjs` from 21 preserved batch JSONs using the
exact per-fixture code as live runs (`aggregateFixture` imported from
`benchmarks/run.mjs`).

## What was measured

120 clean steady runs (20/fixture × 6 fixtures), each fixture's cold excluded;
14 failed captures (5 FastVLM-hang timeouts + 9 unpaired follow-ups) counted,
never averaged; 0 degraded runs. Latency (E2E + 8 stages), offscreen JS heap
before/after + drift verdict, Windows Chrome CPU/run, tier paths, fallback
flags, PII P/R/F1 vs `benchmarks/ground_truth/*.json`, redaction
coverage/under/over/preservation/OCR-leak (+IoU machinery present but null —
no GT boxes), 17 visual tasks (10 static + 7 live), env + model census.
Pre-existing latency/resource semantics untouched; accuracy fields additive.

## Methodology

`capture_tab` over MCP HTTP exactly like an agent, guided active-tab flow with
URL verification (one wrong-tab refusal observed live: harness aborted cleanly
with an empty file, proving the guard). Sequential, 2 s settle gap, 600 s
per-capture ceiling, 3-consecutive-failure abort, offscreen recycle default
15. Wedge-aborted batches were topped up with small `--runs=N` batches;
micro-aggregation across batch files is identical to one long run (all batch
IDs and per-batch colds preserved in each fixture's `batches`/`batchColds`).
Matching rules (`lib/accuracy.mjs`) frozen before the session; no post-hoc
tuning — GT gaps found during analysis are reported as artifacts, not fixed.

## Dataset size

6 localhost fixtures, 60 GT entities (37 REDACT-with-text positives, 23 LEAVE
decoys), 17 visual tasks. `invoice-v2.html` (new, `@acme-invoice.test`
positives) makes recall measurable; text-heavy `@example.*` stays LEAVE decoys
by pipeline design. All values synthetic except the repo's sample certificate
image (`doc-face.png`), whose printed text the pipeline reads and the
face/document GT does not enumerate (see limitations). No real personal data.

## Ground-truth definition

ambiguous.html GT = user-approved shakedown M3 list, not re-decided.
text-heavy/invoice-v2 entities derived from fixture content with per-entity
rationale in-file. Face/document GT covers the DOM layer; FACE regions carry
`bbox_method: runtime` (resolved from `face_detection.faces`, never
hand-invented). TP/FP/FN per `lib/accuracy.mjs` header; redaction metrics per
`lib/redaction.mjs` header.

## Known limitations

1. FastVLM wedge: 5 events / 68 Tier-2 attempts (7.4%), any page size; each
   kills the offscreen document (bridge exonerated from code: no socket
   timeouts exist; extension reconnect loop never self-healed → full document
   death). Session required 11 reload+repairs.
2. Recall gaps (F2): invoice ADDRESS-family/TAX_ID/ORDER_REF/TRACKING/
   ACCESS_CODE/EMPLOYEE_ID and second names systematically missed.
3. OCR-leak 0.44: missed values persist in `redacted_ocr_text` (spacing-split
   values partially evade chunk masking).
4. GT-incompleteness artifacts (unfixed by design): document P=0.000 and 17
   face FPs are correct FACE detections the text-matcher can't score; 20 face
   FPs are a missing submitted-date decoy; 12 are true certificate print
   outside GT scope. Overall P=0.790 includes these; per-fixture rows tell the
   true story.
5. `fallback=true` on 100% of runs (flag means fusion/fallback path taken,
   including T2-skips — a semantics note, not a failure).
6. OCR/NER report ~0 ms on fast paths while `done` (F5 open); clean E2E is
   bimodal across sessions (1.1 s smoke vs 2.1 s baseline); document min
   227 ms single-run outlier retained, cause not established.
7. Heap verdicts GC-confounded except ambiguous's clean +2.8 MB/run climb
   (candidate, needs longer N).
8. NOT MEASURED: pixel-level redaction, IoU, browser version (Chrome
   154.0.8037.57 is host-observed, not from evidence), GPU/VRAM utilization,
   per-model ablation, cross-device comparison (record-only device).

## Reproducibility

Daemon with `PERSCOPE_TOOL_TIMEOUT_MS=600000`; extension loaded from current
`extension/v7 beta` build + paired; `node benchmarks/serve-fixtures.mjs`
(any free port) or `--fixture-base`; `node benchmarks/run.mjs --runs=20
--fixtures=<id> --fixture-base=<url> --yes` per fixture (or `--fixtures=all`
with guided prompts); `node benchmarks/combine-baseline.mjs --files=...`
for the official aggregate; `node benchmarks/run.mjs --self-test` for
harness verification (passes). Every result JSON stores commit, env, models,
flags, GT files, and per-run finding text/bbox excerpts. `latest.md`
regenerates per aggregate. Expect wedge-aborts on T2 fixtures: keep batch
files, top up with small `--runs`, combine — do not cherry-pick.
