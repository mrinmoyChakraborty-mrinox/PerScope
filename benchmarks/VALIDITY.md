# PerScope benchmark — validity statement (accuracy-extended harness)

Bench commit: `d8072c4`. Harness: `benchmarks/` (extended in place; no separate system).

## What was measured

- Latency/resource layer (pre-existing, preserved unchanged): end-to-end and
  per-stage latency (DEVICE, IMAGE_DECODE, FACE, OCR, NER, HEURISTICS, FASTVLM,
  REDACT), offscreen JS-heap before/after + drift verdict, Windows Chrome CPU
  per run, tier-escalation path/rate, fallback/degraded-run accounting with
  cold/steady separation. Untouched semantics: same orchestration, same
  `summarize` (nearest-rank p95), same degraded-run exclusion, same JSON schema
  plus additive accuracy fields.
- Accuracy layer (new, this change): PII precision/recall/F1 vs
  `benchmarks/ground_truth/*.json` (TP = REDACT entity text-matched by >=1
  finding; FP = finding matching no REDACT entity; FN = unmatched REDACT;
  normalized containment either direction, min 3 chars; type aliases
  PERSON_NAME~FIRST/LAST/NAME, ADDRESS~STREET_ADDRESS, DATE~DOB/TIME; code:
  `benchmarks/lib/accuracy.mjs`); redaction text-coverage/under/over/
  preservation/OCR-leak plus box-IoU where GT boxes exist, predicted regions
  via `canvas-redactor.js` dedup+clamp semantics with parity unit tests
  (`benchmarks/lib/redaction.mjs`); deterministic visual-context tasks, static
  (fixture source) + live (run evidence), reported separately
  (`benchmarks/lib/visual-tasks.mjs`, `ground_truth/visual-tasks.json`).
- Verified this session: `node benchmarks/run.mjs --self-test` passes (incl.
  new assertions); 10/10 static visual tasks pass against fixture sources;
  ground-truth census (60 entities); daemon reachable but no live guided runs.

## Methodology

Live runs drive `capture_tab` over MCP exactly like an agent, one cold warm-up
+ N steady runs per fixture with active-tab verification, gap settle delay,
and abort-safety. Accuracy is scored micro (TP/FP/FN summed) over clean steady
runs only — degraded/failed runs are counted, never averaged in. Static visual
tasks read the fixture files; live tasks read stored run fields (ocrItems from
OCR stage info, tier2Fired from FASTVLM status, findingCount, faceCount).

## Dataset size

6 fixtures, 60 ground-truth entities (37 REDACT-with-text positives, 23 LEAVE
decoys/negatives), 17 visual tasks (10 static, 7 live). invoice-v2.html added
so recall is measurable on non-placeholder domains (@acme-invoice.test);
text-heavy placeholder emails are LEAVE decoys by pipeline design
(EXAMPLE_EMAIL_DOMAINS). No real personal data anywhere; all values synthetic.

## Ground-truth definition

ambiguous.html GT = user-approved shakedown.md M3 list (REDACT 3524/8810/
WBSC0LM1234/Tamluk@2019/jeet-dot-routh-at-gmail; 10 LEAVE items) — not
re-decided. text-heavy/invoice-v2/face/clean/document GT derived from fixture
content with per-entity rationale in-file. No pixel bboxes are hand-invented:
FACE regions resolve at runtime from `face_detection.faces` + image dims.

## Known limitations

1. No live controlled baseline yet (N=20x6 pending a guided session); all live
   metrics are NOT MEASURED, never estimated.
2. Text matching is normalized-containment, not span-exact; OCR garbling
   ("em ail") can cause FNs the pipeline arguably got right visually.
3. IoU is null until GT boxes exist (only FACE runtime boxes); text redaction
   is scored via region/text outcomes, not pixels (pixels need OffscreenCanvas).
4. FastVLM-error fallback runs still score (detection may come from fusion
   fallback — adjudication/fallback fields are recorded alongside).
5. Prior issues carried forward: FastVLM dominance on dense pages, Tier-0
   under-fire hypothesis, session degradation (recycle default 15), OCR ~0-1ms
   anomaly, clean-T2 anomalies — now measurable, not yet resolved live.
6. face.html/document.html image paths fixed this change; live runs pending.

## Reproducibility

Run: start bridge daemon with `PERSCOPE_TOOL_TIMEOUT_MS=600000`, load extension
from current `extension/v7 beta` build, pair once, serve fixtures, then
`npm run benchmark -- --runs=20 --fixtures=all --yes`. Every result JSON stores
commit, env (Node/OS/CPU/RAM; browser/GPU recorded when observable), models
seen in evidence, flags, GT files, and per-run finding text/bbox excerpts.
`benchmarks/latest.md` regenerates each run with PII/redaction/visual/
environment sections appended to the preserved latency report.
