# PerScope benchmark - latest

- Date (UTC): 2026-09-28T05:18:13.749Z
- Commit: d8072c4
- Device: integrated (amd GPU) (WebGPU tier/agent: record-only: per-run device forcing is not possible via bridge (offscreen passes options:{}))
- Runs per fixture: 1 steady + 1 cold-start (reported separately, excluded from steady stats)
- Fixtures: ambiguous
- MCP: http://127.0.0.1:7332/mcp * fixtures: http://127.0.0.1:7351/

## Steady-state stage latency (ms, all fixtures pooled)

| stage | mean | p50 | p95 | max | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| DEVICE | 0.0 | 0.0 | 0.0 | 0.0 | 1 |
| IMAGE_DECODE | 1087.0 | 1087.0 | 1087.0 | 1087.0 | 1 |
| FACE | 76.0 | 76.0 | 76.0 | 76.0 | 1 |
| OCR | 1.0 | 1.0 | 1.0 | 1.0 | 1 |
| NER | 229.0 | 229.0 | 229.0 | 229.0 | 1 |
| HEURISTICS | 4.0 | 4.0 | 4.0 | 4.0 | 1 |
| FASTVLM | 12758.0 | 12758.0 | 12758.0 | 12758.0 | 1 |
| REDACT | 1230.0 | 1230.0 | 1230.0 | 1230.0 | 1 |

Total (pipeline totalTimeMs): | total | 15387.0 | 15387.0 | 15387.0 | 15387.0 | 1 |

## Cold start vs steady (total ms per fixture)

| fixture | cold (run 1) | steady p50 | steady p95 |
| --- | ---: | ---: | ---: |
| ambiguous | 34795 | 15387 | 15387 |

## Memory (JS heap, offscreen document, per capture_tab run)

| fixture | p50 before (MB) | p50 delta/run (KB) | drift slope (KB/run) | verdict |
| --- | ---: | ---: | ---: | --- |
| ambiguous | 49.0 | 964725.8 | - | single sample - no drift measurable |

> Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). A rising post-run baseline across identical runs is the leak signal - slope >256KB/run with >1MB total growth flags it.

## Tier escalation (detection path per run)

Escalation rate (Tier 2 adjudication fired): **100.0%** (1/1 steady runs)

| path | runs | share |
| --- | ---: | ---: |
| T0+T1+T2 | 1 | 100.0% |

Expected by construction: clean ~0% Tier 2 (text-free page => FastVLM skips); ambiguous ~100%.

## CPU (Chrome process CPU-seconds per capture_tab run, Windows only)

Wall time says WHERE time goes; CPU seconds say WHAT burns. Per-stage CPU attribution is impossible from outside the renderer, so CPU is per-run and stages stay per-stage. >100% utilization = multi-threaded (WASM/model workers).

| fixture | CPU/run p50 (s) | utilization p50 (%) |
| --- | ---: | ---: |
| ambiguous | 6.2 | 38 |

## Per-fixture breakdown

| fixture | designed to exercise | steady p50 total (ms) | findings/run (p50) | entity types seen | T2 rate |
| --- | --- | ---: | ---: | --- | ---: |
| ambiguous | masked/partial PII strings; forces Tier 2 adjudication | 15387 | 0 |  | 100% |

## Accuracy proxies (no ground truth - counts only, never precision/recall)

| fixture | finding-type histogram (steady runs pooled) | confidence bins (p25/median/p75 of scores) | adjudication fallback share |
| --- | --- | --- | ---: |
| ambiguous | - | - | 100% |

> Follow-up: labeled fixtures with span-level ground truth for real precision/recall (PS metrics 1-3).
> Until then these proxies are the baseline to diff against.

## Flags

- none
