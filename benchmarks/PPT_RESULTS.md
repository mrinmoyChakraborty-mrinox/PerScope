# PerScope benchmark — SIH presentation results (verified only)

Official baseline: `benchmarks/results/official-baseline-2026-09-28_23-37-36.json`
(commit `43bed93` + uncommitted extension changes already built into `dist/`).
120 clean steady runs (20/fixture × 6 fixtures) + excluded colds.
14 failed captures excluded per rules (5 FastVLM-hang wedges + 9 unpaired
follow-ups), 0 degraded. Every number below is measured; anything unmeasured
says NOT MEASURED.

## SIH METRIC 1 — Visual Context Accuracy

Definition: 17 deterministic tasks over the 6 fixture pages. Static tasks are
checked against the fixture file source; live tasks against stored run fields
(`ocrItems`, FASTVLM status, finding count, face count). Reported separately,
never mixed (`benchmarks/lib/visual-tasks.mjs`).

- Static: **100% (10/10 passed, 0 skipped)**
- Live (run evidence): **97.9% (137/140 scored)** — the 3 failures are all
  `face-detects-face` on the 3 fast-path `face` runs where BlazeFace returned
  `faceCount=0` (17/20 pass rate on that task; all other live tasks 100%).

## SIH METRIC 2 — PII Detection (ground truth vs `final_findings`)

Definitions (`benchmarks/lib/accuracy.mjs`, frozen before the runs): TP =
REDACT entity text-matched by ≥1 finding (normalized containment either
direction, min 3 chars); FP = finding matching no REDACT entity; FN =
unmatched REDACT entity. Micro-averaged over clean steady runs.

| scope | TP | FP | FN | precision | recall | F1 | runs | GT REDACT |
|---|---|---|---|---|---|---|---|---|
| overall | 409 | 109 | 291 | 0.790 | 0.584 | 0.672 | 120 | 37 text entities |
| ambiguous | 100 | 0 | 0 | 1.000 | 1.000 | 1.000 | 20 | 5 |
| text-heavy | 152 | 20 | 168 | 0.884 | 0.475 | 0.618 | 20 | 16 |
| invoice-v2 | 140 | 20 | 100 | 0.875 | 0.583 | 0.700 | 20 | 12 |
| face | 17 | 49 | 23 | 0.258 | 0.425 | 0.321 | 20 | 2 (+1 visual-only FACE) |
| document | 0 | 20 | 0 | 0.000* | null | null | 20 | 0 text (+1 visual-only FACE) |
| clean | 0 | 0 | 0 | null | null | null | 20 | 0 |

*Document 0.000 is a measurement artifact, not a pipeline failure: its single
finding every run is a correct FACE detection with empty text, which the
text-matcher cannot score (no text GT exists for the scan). Same artifact
covers 17 of face's 49 FPs. A further 20 face FPs are the rendered
`09/20/2026` date missing from face GT as a decoy, and 12 are true printed
certificate text the photo contains (GT covers only the HTML layer).
Ground truth was NOT extended after seeing results; these artifacts are
reported, not tuned away. Type mismatches: 80 (largest: CARD_NUMBER findings
for ACCOUNT_NUMBER GT — alias absent from the frozen matcher).
Over-redactions onto LEAVE: 20, all on text-heavy — the pipeline flags the
placeholder `eleanor.rigby@example.com` (OCR-glued as
`eleanor.rigby@example.comVATID`) despite the EXAMPLE_EMAIL_DOMAINS filter.

Recall gaps (F2 reproduced): text-heavy ADDRESS/TAX_ID/ORDER_REF/TRACKING/
ACCESS_CODE/EMPLOYEE_ID 0.00 recall, PERSON_NAME 0.50 (`Marcus Chen` never
found); invoice-v2 `Rina Das`, `accounts@acme-invoice.test`, `OD-2026-7719`
missed; `HDFC0001234` OCR-misread as `HDFCo001234`, breaking the text match
(real OCR-robustness signal: IFSC recall 0.00 with 20 UNMATCHED(IFSC) FPs).

## SIH METRIC 3 — Redaction

Predicted regions = finding bboxes through `canvas-redactor.js` dedup+clamp
semantics (parity unit-tested); counts = pipeline REDACT-stage output
(`benchmarks/lib/redaction.mjs`). Means over runs.

| scope | coverage (recall) | under-redaction | precision (1 − over-redaction) | over-redaction | preservation | OCR leak | OCR kept | IoU |
|---|---|---|---|---|---|---|---|---|
| overall (mean of fixture means) | 0.621 | 0.379 | 0.977 | 0.023 | 0.958 | 0.444 | 1.000 | NOT MEASURED (no GT boxes exist) |
| ambiguous | 1.000 | 0.000 | 1.000 | 0.000 | 1.000 | 0.200 | 1.000 | — |
| text-heavy | 0.475 | 0.525 | 0.883 | 0.117 | 0.833 | 0.500 | 1.000 | — |
| invoice-v2 | 0.583 | 0.417 | 1.000 | 0.000 | 1.000 | 0.500 | 1.000 | — |
| face | 0.425 | 0.575 | 1.000 | 0.000 | 1.000 | 0.575 | 1.000 | — |

OCR leak = REDACT GT text still present (normalized) in
`redaction.redacted_ocr_text`. Verified by hand on samples: ambiguous
`WBSC0LM1234` survives as OCR-spaced `W BSC0LM 1234`; text-heavy leaves the
street address, order ref, VAT ID and placeholder email in the redacted text.
Representative before/GT/detected/redacted evidence per fixture is stored in
each fixture's `redactionEvidence` block in the official JSON.

## SIH METRIC 4 — Client-side Resource Utilization

JS heap = offscreen `performance.memory` before/after each capture
(post-cleanup). Chrome CPU = `Get-Process chrome` CPU-seconds delta per run
(Windows). GPU events = pipeline `gpuEvents` log.

| fixture | heap p50 before (MB) | heap drift verdict | CPU/run p50 (s) | CPU util p50 | GPU events |
|---|---|---|---|---|---|
| clean | 43.1 | stable (−2007 KB/half) | 0.9 | 30% | 0 runs |
| ambiguous | 350.0 | LEAK SIGNAL (+5512 KB/half, +2.77 MB/run slope) | 11.2 | 139% | 0 runs |
| text-heavy | 326.8 | stable (+233 KB/half) | 29.7 | 129% | 0 runs |
| invoice-v2 | 338.7 | stable (+742 KB/half) | 6.8 | 77% | 0 runs |
| face | 27.3 | stable (−1065 KB/half) | 0.6 | 21% | 0 runs |
| document | 47.2 | stable (+1934 KB/half, negative slope — GC sawtooth) | 0.6 | 23% | 0 runs |

>100% CPU = multi-threaded WASM/model workers (expected). GPU utilization /
VRAM: NOT MEASURED (no pipeline hook). Model footprint (shipped artifacts):
PaddleOCR ~38 MB, Ettin-68M 278 MB (fp32), BlazeFace 0.5 MB
(`models/model-manifest.json`); FastVLM-0.5B ~780 MB q4f16 runtime cache
(README; not in `dist/`, downloaded on first run).

## SIH METRIC 5 — E2E Latency (`totalTimeMs`, ms)

FastVLM dominates every Tier-2 fixture (63% of E2E on ambiguous, 94% on
text-heavy). Fallback/adjudication flag: 100% of runs (flag means
fusion/fallback path taken, including T2-skips). Tier-2 escalation: 52.5%
(63/120). Fast path (T0+T1) E2E ≈ 2.1 s, dominated by IMAGE_DECODE (~1.08 s)
+ REDACT (~1.04 s); OCR/NER/HEURISTICS report ~0 ms on the fast path (F5,
still open — NER status is `done` with real behavior downstream).

| fixture | cold | mean | p50 | p95 | min | max | std | n |
|---|---|---|---|---|---|---|---|---|
| clean | 6317 | 1985 | 2138 | 2156 | 1098 | 2164 | 382 | 20 |
| ambiguous | 21546 | 7350 | 7322 | 7796 | 7129 | 7885 | 218 | 20 |
| text-heavy | 32169 | 21116 | 22469 | 23316 | 17979 | 25105 | 2389 | 20 |
| invoice-v2 | 16791 | 8264 | 8242 | 8626 | 7957 | 8731 | 215 | 20 |
| face | 8224 | 2966 | 2145 | 7231 | 2126 | 8465 | 2024 | 20 (bimodal: 17 fast-path + 3 T2) |
| document | 6643 | 2033 | 2127 | 2141 | 2126 | 2143 | 425 | 20 (min 227: single-run IMAGE_DECODE+REDACT fast outlier, same FACE finding, cause not established, retained per rules) |

Per-stage medians (ms): ambiguous DEVICE 0 / DECODE 5.5 / FACE 6 / OCR 0 /
NER 190.5 / HEUR 2 / FASTVLM 6074 / REDACT 1032.5; text-heavy FASTVLM 21171.5
(balance ~1.3 s); invoice-v2 FASTVLM 5923.5; face batch-dependent (T2 runs
FASTVLM ~5042, skip runs NER ~48).

Reliability (measured, not a metric): **5 FastVLM-hang wedges in 68 Tier-2
capture attempts (7.4%)** — each wedge (600 s of silence, past the 120 s
internal guard) killed the offscreen document and unpaired the extension;
14 failed captures excluded, all preserved in batch JSONs.

## BENCHMARK ENVIRONMENT

- Hardware: AMD Ryzen 7 7445HS w/ Radeon 740M (12 logical), 15.3 GB RAM;
  GPUs present: RTX 4050 Laptop 4 GB + Radeon 740M 512 MB.
  **Pipeline selected `integrated (amd GPU)` on every run — the RTX 4050 was
  never used** (device forcing is impossible via bridge; record-only).
- Browser: Chrome 154.0.8037.57 (host `chrome.exe` product version;
  `capture_tab` evidence carries no browser version).
- Models (from run evidence): Ettin `models/ettin-68m-nemotron-pii-onnx`,
  BlazeFace `garavv/blazeface-onnx`, FastVLM `onnx-community/FastVLM-0.5B-ONNX`.
- Runtimes: Node v24.14.0, onnxruntime-web 1.29.0, @huggingface/transformers
  4.2.0, extension 1.0.1 (`extension/v7 beta/dist`, rebuilt after the
  uncommitted heuristic changes).
- Bench: commit `43bed93` (+ uncommitted extension work, built into dist),
  2026-09-28 evening IST session, `capture_tab` over MCP HTTP, fixture server
  on :7351, per-capture ceiling 600 s, 2 s settle gap, offscreen recycle
  default 15. Command per batch: `node benchmarks/run.mjs --runs=N
  --fixtures=<id> --fixture-base=http://127.0.0.1:7351 --yes`; aggregation:
  `node benchmarks/combine-baseline.mjs --files=<20 batch JSONs>`.
- Batch files: 21 JSONs in `benchmarks/results/` (20 steady-batches + 1
  cold-only wedge batch), all preserved.

## LIMITATIONS (real, no marketing)

- FastVLM hangs intermittently (~7% of Tier-2 captures, any page size) and
  each hang kills the extension session; dense pages take ~22 s (text-heavy)
  vs ~7 s (ambiguous) for the same pipeline.
- PII recall is 0.48–0.58 on invoices: addresses, IDs, order/tracking refs
  and second names are systematically missed (Tier-0 under-fire, F2).
- Redacted OCR text still leaks missed values (OCR leak 0.44 overall);
  pixel-level redaction was scored via geometry, not pixels (no canvas in
  Node); IoU is NOT MEASURED.
- Face/document GT covers the DOM layer only; certificate-image print is
  detected but unscored (GT frozen before runs, not extended afterward).
- Heap-leak verdicts are GC-confounded (document/face show ±MB swings with
  negative slopes); only ambiguous's +2.8 MB/run climb is a clean LEAK SIGNAL.
- Browser version and GPU/VRAM utilization are NOT MEASURED through the
  current harness; device selection is record-only.
