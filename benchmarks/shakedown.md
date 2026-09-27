# PerScope benchmark shakedown - working document

Date: 2026-09-27. Harness: `benchmarks/` @ commit after `aaf219c` (uncommitted
harness fixes below are in the working tree). Device recorded every run:
`integrated (amd GPU)` - note: NOT the dedicated RTX 4050; device selection
is record-only (bridge capture passes `options:{}`).

## Batches run (all live, daemon 600s ceiling, paired extension)

| batch | fixture | runs | cold total | steady p50 total | tiers | findings | T2 rate | memory verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | clean x5 | 1+5 | 2.4s | ~2.19s | T0+T1 | 0 | 0% | LEAK SIGNAL (+1.25MB/run consistent climbs) |
| 2 | ambiguous x5 | 1+5 | 45.5s | ~29s (26-36s spread) | T0+T1+T2 | 1 | 100% | LEAK SIGNAL (+0.88MB/run, noisy) |
| 3 | text-heavy x5 | 1+5 | 56.7s | error-fast ~3.5s | T0~T1(err)~T2(err) | 0 | n/a (degraded) | +70MB/run transient, flat baseline |
| 4 | text-heavy x1 (post-reload) | 1+1 | 51.6s | 45.3s | T0+T1+T2 | 4 | 100% | cold +1.27GB (model load), steady -1MB |
| earlier | clean x2/x3 sessions | - | 7.0s/7.6s | ~2.18s/~2.19s | T0+T1 | 0 | 0% | stable / stable |

Raw JSONs: `benchmarks/results/2026-09-27_15-*.json`, `16-06-34.json`, `16-53-27.json`,
`16-58-11.json`, `17-01-30.json`, `17-10-15.json`.

## Findings (numbered for tracking)

- **F1. FastVLM dominates and fails on dense input.** Ambiguous/text-heavy:
  FASTVLM 35.7s/42.4s of 38.3s/45.3s totals. On text-heavy its status is
  `error` (prose refusal in caption, validation failed) and adjudication
  falls back to NER-only findings (final 4 vs NER 20). Single biggest
  latency lever AND an accuracy lever. Evidence: `17-10-15.json` FASTVLM info.
- **F2. Tier 0 zero-fires on the invoice.** `deterministicCount: 0` on
  text-heavy despite emails/phones/dates everywhere; fused 10 from NER 20.
  Either the heuristics genuinely miss invoice layouts (then T2 carries
  everything expensive) or the fixture dodges the patterns. Needs a
  Tier-0-vs-fixture audit before trusting the escalation story.
- **F3. Session degradation is real; reload recovers.** Batch 3 errored
  steadily (NER+T2 throw); after extension reload the same fixture runs
  clean. Consistent with memory pressure, not fixture content. Implication:
  long sessions need a health signal (or periodic offscreen recycle), and
  any "0 findings" result must be read next to stage statuses - which is now
  exactly what the degraded-run rule enforces.
- **F4. Memory: transient vs drift, separated.** Text-heavy retains ~+70MB
  at the post-cleanup sample but the baseline stays flat (gap GC collects
  it) - transient working set, NOT a leak under the drift rule. Clean shows
  consistent +1.25MB/run climbs and ambiguous +0.88MB/run noisy climbs -
  both flagged as CANDIDATES, not convictions; needs longer N to confirm
  (plateau vs growth). The injected-leak proof (+4002KB/run exact) shows the
  detector fires on the real thing.
- **F5. OCR brackets ~0-1ms with real output (OPEN).** 33 items extracted on
  text-heavy inside 1ms brackets, consistent across cold+steady, stage sums
  reconcile with totals. No clock shadow, single emit sites, no result
  cache in pipeline code. Either remarkably fast warm WASM inference or an
  internal fast path in `ppu-paddle-ocr`. Needs package-level split timing
  (load vs recognize). Headline metrics unaffected.
- **F6. Clean p50 is tight.** ~2.18/2.19s across sessions (~1%) - the fast
  path is stable and cheap. Best-case story holds.
- **F7. Ambiguous variance is wide.** 25.9-35.5s steady (p50 ~29s).
  FastVLM generate variance dominates; n=20 full runs will tighten the read.

## CPU (added, awaiting live numbers)

`lib/cpu.mjs` samples total Chrome CPU-seconds (Windows `Get-Process`)
around each capture: per-run `cpuSec` + `cpuPct` (utilization; >100% =
multi-threaded workers). Reported per fixture in `latest.md`. NOT wired
into any verdict - it is diagnostic for pinpointing optimization targets
(F1's 42s FastVLM wall time wants its CPU number next to it). Per-stage CPU
attribution is impossible externally; the report keeps CPU per-run and
stages per-stage deliberately separate. First live CPU numbers arrive with
the next full run. Non-Windows returns null ("n/a").

## Action items

Architecture (ordered by evidence weight):
1. [A1] FastVLM-on-dense-input: 42s + error-fallback. Investigate error
   cause, fallback finding quality (final 4 vs NER 20), and whether dense
   pages should cap evidence size before adjudication.
2. [A2] Tier-0 audit on invoice layouts (F2). If heuristics under-fire,
   the "lightweight" path never triggers where it should.
3. [A3] Session health: degradation across ~15 captures (F3). Options:
   expose heap in a health probe, recycle offscreen past a threshold, or at
   minimum surface stage-error streaks to the dashboard.
4. [A4] Text-heavy transient (+70MB/run): find what retains post-cleanup
   within a run (arenas? bitmaps? base64 strings?) even though gaps collect it.
5. [A5] OCR package timing split (F5).

Measurement:
1. [M1] Full N=20 x5 suite in one controlled session, commit `latest.md`
   as the official baseline (shakedown numbers above are rehearsal, not baseline).
2. [M2] Longer-N drift confirmation for the clean/ambiguous candidates (F4).
3. [M3] Labeled fixtures for real precision/recall (PS metrics 1-3). NOTE
   (carried forward 2026-09-27): text-heavy.html uses @example.com /
   @example.org addresses, which match the pipeline's EXAMPLE_EMAIL_DOMAINS
   placeholder set - the NER chunk filter may treat them as examples. Labeled
   fixtures must use fictitious but NON-placeholder domains
   (e.g. @acme-invoice.test) or ground truth will disagree with the pipeline
   by design.
4. [M4] First live CPU table from the full run; decide verdicts later, if ever.

## Harness changes made during shakedown (in tree, unpushed)

- Degraded-run handling (stage error/open => excluded from stats, flagged).
- Robust drift rule (median-halves + positive slope; least-squares alone
  flips sign on GC plunges).
- Abort-safety (partial outputs written, run re-throws for exit code).
- Active-tab verify, consecutive-failure abort with timeout guidance.
- `latest.md` p50 labeling, ASCII-safe output, `exitCode` teardown fix.
- DEVICE START/DONE marks, capped `info` payloads per stage.
