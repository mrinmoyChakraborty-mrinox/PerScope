# PerScope benchmark - latest

- Date (UTC): 2026-09-28T23:37:36.440Z
- Commit: 43bed93
- Device: integrated (amd GPU) (WebGPU tier/agent: record-only: per-run device forcing is not possible via bridge (offscreen passes options:{}))
- Runs per fixture: 20 steady + 1 cold-start (reported separately, excluded from steady stats)
- Fixtures: clean, ambiguous, text-heavy, invoice-v2, face, document
- MCP: http://127.0.0.1:7332/mcp * fixtures: http://127.0.0.1:7351/

## Steady-state stage latency (ms, all fixtures pooled)

| stage | mean | p50 | p95 | max | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| DEVICE | 0.0 | 0.0 | 0.0 | 1.0 | 120 |
| IMAGE_DECODE | 746.6 | 1046.5 | 1088.0 | 1098.0 | 120 |
| FACE | 8.6 | 6.0 | 22.0 | 73.0 | 120 |
| OCR | 0.2 | 0.0 | 1.0 | 1.0 | 120 |
| NER | 119.5 | 147.5 | 246.0 | 305.0 | 120 |
| HEURISTICS | 1.4 | 1.0 | 4.0 | 5.0 | 120 |
| REDACT | 1029.4 | 1037.0 | 1052.0 | 1067.0 | 120 |
| FASTVLM | 10246.3 | 6114.0 | 21681.0 | 23808.0 | 63 |

Total (pipeline totalTimeMs): | total | 7285.6 | 7146.0 | 22809.0 | 25105.0 | 120 |

## Cold start vs steady (total ms per fixture)

| fixture | cold (run 1) | steady p50 | steady p95 |
| --- | ---: | ---: | ---: |
| clean | 6317 | 2138 | 2156 |
| ambiguous | 21546 | 7322 | 7796 |
| text-heavy | 32169 | 22469 | 23316 |
| invoice-v2 | 16791 | 8242 | 8626 |
| face | 8224 | 2145 | 7231 |
| document | 6643 | 2127 | 2141 |

## Memory (JS heap, offscreen document, per capture_tab run)

| fixture | p50 before (MB) | p50 delta/run (KB) | drift slope (KB/run) | verdict |
| --- | ---: | ---: | ---: | --- |
| clean | 43.1 | 1253.9 | -1146.8 | stable (drift -2007.3KB per half, slope -1146.8KB/run) |
| ambiguous | 350.0 | 5547.8 | 2765.4 | LEAK SIGNAL - heap drifts +5511.6KB per half with positive slope (+2765.4KB/run, |
| text-heavy | 326.8 | 1312.9 | -56.7 | stable (drift 232.8KB per half, slope -56.7KB/run) |
| invoice-v2 | 338.7 | 1890.4 | 267.8 | stable (drift 742.3KB per half, slope 267.8KB/run) |
| face | 27.3 | 501.6 | -10019.8 | stable (drift -1065.1KB per half, slope -10019.8KB/run) |
| document | 47.2 | 1037.4 | -2354.5 | stable (drift 1933.8KB per half, slope -2354.5KB/run) |

> Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). A rising post-run baseline across identical runs is the leak signal - slope >256KB/run with >1MB total growth flags it.

## Tier escalation (detection path per run)

Escalation rate (Tier 2 adjudication fired): **52.5%** (63/120 steady runs)

| path | runs | share |
| --- | ---: | ---: |
| T0+T1 | 57 | 47.5% |
| T0+T1+T2 | 63 | 52.5% |

Expected by construction: clean ~0% Tier 2 (text-free page => FastVLM skips); ambiguous ~100%.

## CPU (Chrome process CPU-seconds per capture_tab run, Windows only)

Wall time says WHERE time goes; CPU seconds say WHAT burns. Per-stage CPU attribution is impossible from outside the renderer, so CPU is per-run and stages stay per-stage. >100% utilization = multi-threaded (WASM/model workers).

| fixture | CPU/run p50 (s) | utilization p50 (%) |
| --- | ---: | ---: |
| clean | 0.9 | 30 |
| ambiguous | 11.2 | 139 |
| text-heavy | 29.7 | 129 |
| invoice-v2 | 6.8 | 77 |
| face | 0.6 | 21 |
| document | 0.6 | 23 |

## Per-fixture breakdown

| fixture | designed to exercise | steady p50 total (ms) | findings/run (p50) | entity types seen | T2 rate |
| --- | --- | ---: | ---: | --- | ---: |
| clean | zero rendered text; best-case fast path, Tier 2 must skip | 2138 | 0 |  | 0% |
| ambiguous | masked/partial PII strings; forces Tier 2 adjudication | 7322 | 5 | CARD_NUMBER, EMAIL, IFSC, PASSWORD | 100% |
| text-heavy | dense synthetic PII text; full T0+T1+T2 path | 22469 | 9 | CARD_NUMBER, DATE, EMAIL, PHONE, date, first_name | 100% |
| invoice-v2 | invoice with NON-placeholder domains; measurable PII recall + decoys | 8242 | 8 | CARD_NUMBER, DATE, EMAIL, IFSC, PHONE, date, first_name, street_address | 100% |
| face | large ID photo + sparse text; face-detection exercise | 2145 | 3 | DATE, FACE, credit_debit_card, date, first_name, gender | 15% |
| document | scanned-document image with photo + print; OCR-on-image + face | 2127 | 1 | FACE | 0% |

## Accuracy proxies (no ground truth - counts only, never precision/recall)

| fixture | finding-type histogram (steady runs pooled) | confidence bins (p25/median/p75 of scores) | adjudication fallback share |
| --- | --- | --- | ---: |
| clean | - | - | 100% |
| ambiguous | PASSWORD:20, EMAIL:20, IFSC:20, CARD_NUMBER:40 | 0.900/0.900/0.900 | 100% |
| text-heavy | EMAIL:20, date:20, PHONE:32, first_name:20, DATE:60, CARD_NUMBER:20 | 0.900/1.000/1.000 | 100% |
| invoice-v2 | street_address:20, EMAIL:20, date:20, PHONE:20, IFSC:20, first_name:20, DATE:20, | 1.000/1.000/1.000 | 100% |
| face | date:3, first_name:20, credit_debit_card:3, DATE:20, gender:3, FACE:17 | 0.900/0.900/1.000 | 100% |
| document | FACE:20 | 0.900/0.900/0.900 | 100% |

> Follow-up: labeled fixtures with span-level ground truth for real precision/recall (PS metrics 1-3).
> Until then these proxies are the baseline to diff against.

## PII detection accuracy (ground truth vs final_findings)

TP = REDACT entity matched by >=1 finding (normalized text containment either direction, min 3 chars). FP = finding matching no REDACT entity. FN = REDACT entity matched by no finding. Matching: benchmarks/lib/accuracy.mjs.

| fixture | TP | FP | FN | precision | recall | F1 | runs | GT REDACT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean | 0 | 0 | 0 | - | - | - | 20 | 0 |
| ambiguous | 100 | 0 | 0 | 100.0% | 100.0% | 100.0% | 20 | 5 |
| text-heavy | 152 | 20 | 168 | 88.4% | 47.5% | 61.8% | 20 | 16 |
| invoice-v2 | 140 | 20 | 100 | 87.5% | 58.3% | 70.0% | 20 | 12 |
| face | 17 | 49 | 23 | 25.8% | 42.5% | 32.1% | 20 | 2 |
| document | 0 | 20 | 0 | 0.0% | - | - | 20 | 0 |

Overall (micro over 120 steady runs): TP=409 FP=109 FN=291 precision=79.0% recall=58.4% F1=67.2% (type mismatches: 80, over-redactions onto LEAVE: 20).

<details><summary>Per-entity-type P/R/F1 (diagnostic)</summary>

| fixture | entity type | TP | FP | FN | precision | recall | F1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ambiguous | ACCOUNT_NUMBER | 40 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| ambiguous | IFSC | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| ambiguous | PASSWORD | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| ambiguous | EMAIL | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| text-heavy | PERSON_NAME | 20 | 0 | 20 | 100.0% | 50.0% | 66.7% |
| text-heavy | ADDRESS | 0 | 0 | 40 | - | 0.0% | - |
| text-heavy | PHONE | 32 | 0 | 8 | 100.0% | 80.0% | 88.9% |
| text-heavy | DATE | 80 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| text-heavy | EMPLOYEE_ID | 0 | 0 | 20 | - | 0.0% | - |
| text-heavy | CARD_LAST4 | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| text-heavy | TAX_ID | 0 | 0 | 20 | - | 0.0% | - |
| text-heavy | ORDER_REF | 0 | 0 | 20 | - | 0.0% | - |
| text-heavy | TRACKING | 0 | 0 | 20 | - | 0.0% | - |
| text-heavy | ACCESS_CODE | 0 | 0 | 20 | - | 0.0% | - |
| text-heavy | UNMATCHED(EMAIL) | 0 | 20 | 0 | 0.0% | - | - |
| invoice-v2 | PERSON_NAME | 20 | 0 | 20 | 100.0% | 50.0% | 66.7% |
| invoice-v2 | ADDRESS | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| invoice-v2 | EMAIL | 20 | 0 | 20 | 100.0% | 50.0% | 66.7% |
| invoice-v2 | PHONE | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| invoice-v2 | DATE | 40 | 0 | 20 | 100.0% | 66.7% | 80.0% |
| invoice-v2 | IFSC | 0 | 0 | 20 | - | 0.0% | - |
| invoice-v2 | ACCOUNT_NUMBER | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| invoice-v2 | ORDER_REF | 0 | 0 | 20 | - | 0.0% | - |
| invoice-v2 | UNMATCHED(IFSC) | 0 | 20 | 0 | 0.0% | - | - |
| face | PERSON_NAME | 17 | 0 | 3 | 100.0% | 85.0% | 91.9% |
| face | APPLICATION_ID | 0 | 0 | 20 | - | 0.0% | - |
| face | UNMATCHED(date) | 0 | 3 | 0 | 0.0% | - | - |
| face | UNMATCHED(first_name) | 0 | 3 | 0 | 0.0% | - | - |
| face | UNMATCHED(credit_debit_card) | 0 | 3 | 0 | 0.0% | - | - |
| face | UNMATCHED(DATE) | 0 | 20 | 0 | 0.0% | - | - |
| face | UNMATCHED(gender) | 0 | 3 | 0 | 0.0% | - | - |
| face | UNMATCHED(FACE) | 0 | 17 | 0 | 0.0% | - | - |
| document | UNMATCHED(FACE) | 0 | 20 | 0 | 0.0% | - | - |
</details>

## Redaction evaluation (predicted finding bboxes vs ground truth)

Predicted regions = finding bboxes through canvas-redactor.js dedup+clamp semantics; counts = pipeline REDACT stage output. Coverage = REDACT text GT with >=1 predicted region. IoU only where GT boxes exist.

| fixture | coverage | under | mean IoU | box R@0.5 | over-redact | preserved | OCR leak | OCR kept | regions p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean | - | - | - | - | - | - | - | - | 0 |
| ambiguous | 100.0% | 0.0% | - | - | 0.0% | 100.0% | 20.0% | 100.0% | 5 |
| text-heavy | 47.5% | 52.5% | - | - | 11.7% | 83.3% | 50.0% | 100.0% | 9 |
| invoice-v2 | 58.3% | 41.7% | - | - | 0.0% | 100.0% | 50.0% | 100.0% | 8 |
| face | 42.5% | 57.5% | - | - | 0.0% | 100.0% | 57.5% | 100.0% | 3 |
| document | - | - | - | - | 0.0% | - | - | - | 1 |

## Visual-context tasks (deterministic fixture checks)

Static (fixture source): 10/10 passed. Live (run evidence): 137/140 passed = 97.9%.

| task | fixture | expected | actual | pass | evidence |
| --- | --- | --- | --- | --- | --- |
| clean-tier2-skips | clean | false | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| clean-no-findings | clean | 0 | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| amb-ocr-nonempty | ambiguous | 0 | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| amb-tier2-fires | ambiguous | true | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| th-ocr-nonempty | text-heavy | 0 | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| v2-ocr-nonempty | invoice-v2 | 0 | passRate=100.0% over 20 run(s) | pass | live:run-evidence |
| face-detects-face | face | true | passRate=85.0% over 20 run(s) | FAIL | live:run-evidence |

## Environment (Phase 7 record; unobservable fields say NOT MEASURED)

- Node: v24.14.0 | OS: win32 10.0.26200 x64 | CPU: AMD Ryzen 7 7445HS w/ Radeon 740M Graphics      x12 | RAM: 15.3 GB
- Browser: NOT MEASURED (capture_tab evidence carries no browser version; record chrome://v
- GPU: see summary.device (record-only tier label from the extension; full GPU model is | Device seen: integrated (amd GPU)
- Models seen in evidence: {"ner":["models/ettin-68m-nemotron-pii-onnx"],"face":["garavv/blazeface-onnx"],"
- Ground truth: {"dir":"benchmarks/ground_truth","fixtures":{"ambiguous":{"file":"ambiguous.json
- Failed/degraded: 14/0 (rate 10.4%)

## Flags

- [!] ambiguous: 3 run(s) failed (FastVLM-hang wedge + unpaired follow-ups; see batch JSONs).
- [!] ambiguous: LEAK SIGNAL - heap drifts +5511.6KB per half with positive slope (+2765.4KB/run, +14339.2KB total).
- [!] text-heavy: 6 run(s) failed (FastVLM-hang wedge + unpaired follow-ups; see batch JSONs).
- [!] invoice-v2: 5 run(s) failed (FastVLM-hang wedge + unpaired follow-ups; see batch JSONs).
- [!] RELIABILITY: 4 batch(es) aborted by FastVLM-hang wedge killing the extension (2026-09-28_19-28-15.json, 2026-09-28_20-34-14.json, 2026-09-28_20-56-39.json, 2026-09-28_21-24-58.json); 14 failed captures excluded from stats, all preserved in batch JSONs.
