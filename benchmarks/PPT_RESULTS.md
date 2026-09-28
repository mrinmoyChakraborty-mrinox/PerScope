# PerScope benchmark — SIH presentation results (verified only)

Source: `benchmarks/results/official-baseline-stub-verified.json` (bench commit `d8072c4`).
Live N=20 controlled runs have NOT been executed; every live-run metric below is
honestly reported as NOT MEASURED. Do not present these as model/pipeline scores.

| METRIC | value | denominator/sample count | fixture | browser | hardware | model version | benchmark commit |
|---|---|---|---|---|---|---|---|
| Visual context accuracy (static fixture checks) | 100% (10/10) | 10 tasks, 0 skipped | all 6 fixtures | NOT MEASURED | NOT MEASURED | n/a (no model) | d8072c4 |
| Visual context accuracy (live run evidence) | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| PII precision | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| PII recall | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| PII F1 | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Redaction precision (1 − over-redaction) | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Redaction coverage | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Redaction IoU | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Peak/Delta RAM | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| CPU utilization | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| E2E P50 | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| E2E P95 | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Failure/degraded rate | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |
| Tier-2 escalation rate | NOT MEASURED | - | - | NOT MEASURED | NOT MEASURED | NOT MEASURED | d8072c4 |

Verified harness facts suitable for the deck (methodology, not scores):

- Accuracy layer is implemented and self-tested: `node benchmarks/run.mjs --self-test`
  passes stats, PII matching, redaction geometry, visual-task, and
  `canvas-redactor.js` parity checks plus a stub-bridge end-to-end run with
  ground-truth scoring assertions.
- Ground truth exists for 6 fixtures (60 entities: 37 REDACT-with-text, 23 LEAVE):
  `benchmarks/ground_truth/{ambiguous,text-heavy,clean,face,document,invoice-v2}.json`.
- Static visual checks 10/10 pass against the fixture sources the browser renders.
- Prior rehearsal numbers live in `benchmarks/shakedown.md` — rehearsal, NOT baseline.
