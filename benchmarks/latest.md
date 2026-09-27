# PerScope benchmark — latest

- Date (UTC): 2026-09-27T16:06:33.960Z
- Commit: 8d40150
- Device: integrated (amd GPU) (WebGPU tier/agent: record-only: per-run device forcing is not possible via bridge (offscreen passes options:{}))
- Runs per fixture: 1 steady + 1 cold-start (reported separately, excluded from steady stats)
- Fixtures: ambiguous
- MCP: http://127.0.0.1:7332/mcp · fixtures: http://127.0.0.1:7341/

## Steady-state stage latency (ms, all fixtures pooled)

| stage | mean | median | p95 | max | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| IMAGE_DECODE | 1127.0 | 1127.0 | 1127.0 | 1127.0 | 1 |
| FACE | 75.0 | 75.0 | 75.0 | 75.0 | 1 |
| OCR | 0.0 | 0.0 | 0.0 | 0.0 | 1 |
| NER | 244.0 | 244.0 | 244.0 | 244.0 | 1 |
| HEURISTICS | 2.0 | 2.0 | 2.0 | 2.0 | 1 |
| FASTVLM | 35661.0 | 35661.0 | 35661.0 | 35661.0 | 1 |
| REDACT | 1206.0 | 1206.0 | 1206.0 | 1206.0 | 1 |

Total (pipeline totalTimeMs): | total | 38318.0 | 38318.0 | 38318.0 | 38318.0 | 1 |

## Cold start vs steady (total ms per fixture)

| fixture | cold (run 1) | steady median | steady p95 |
| --- | ---: | ---: | ---: |
| ambiguous | 52911 | 38318 | 38318 |

## Memory (JS heap, offscreen document, per capture_tab run)

| fixture | median before (MB) | median delta/run (KB) | drift slope (KB/run) | verdict |
| --- | ---: | ---: | ---: | --- |
| ambiguous | 74.3 | -2022.4 | — | single sample — no drift measurable |

> Heap sampled in the offscreen document immediately before/after each capture (post-cleanup number). A rising post-run baseline across identical runs is the leak signal — slope >256KB/run with >1MB total growth flags it.

## Tier escalation (detection path per run)

Escalation rate (Tier 2 adjudication fired): **100.0%** (1/1 steady runs)

| path | runs | share |
| --- | ---: | ---: |
| T0+T1+T2 | 1 | 100.0% |

Expected by construction: clean ≈0% Tier 2 (text-free page ⇒ FastVLM skips); ambiguous ≈100%.

## Per-fixture breakdown

| fixture | designed to exercise | steady median total (ms) | findings/run (median) | entity types seen | T2 rate |
| --- | --- | ---: | ---: | --- | ---: |
| ambiguous | masked/partial PII strings; forces Tier 2 adjudication | 38318 | 1 | IFSC | 100% |

## Accuracy proxies (no ground truth — counts only, never precision/recall)

| fixture | finding-type histogram (steady runs pooled) | confidence bins (p25/median/p75 of scores) | adjudication fallback share |
| --- | --- | --- | ---: |
| ambiguous | IFSC:1 | — | 100% |

> Follow-up: labeled fixtures with span-level ground truth for real precision/recall (PS metrics 1–3).
> Until then these proxies are the baseline to diff against.

## Flags

- none
