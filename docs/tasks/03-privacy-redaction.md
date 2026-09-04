# Person 3 — Privacy, Detection & Redaction Engineer (Koyel)

**Was:** single redaction pass → **now:** full tiered pipeline (plan/execute split, fail-closed).

## Tiered Pipeline (you own end-to-end)

### Tier 0 — Regex + checksum (fast, always-on)

- Base: OpenRedaction (`sam247/openredaction`) for this tier specifically.
- Run on **both** DOM values **and** OCR text — but differently:
  - **DOM-sourced** checksum hit → trusted directly.
  - **OCR-sourced** hit → trusted **only at high PaddleOCR confidence**; low-confidence or failed checksum → **escalate to Tier1, never silently clear as safe**. This is the v3 failure-mode fix.
- See `piidetector.js` for pattern + Luhn/IBAN validators and confidence context logic.

### Tier 1 — Ettin-68M NER (core, not stretch)

- `kalyan-ks/ettin-68m-nemotron-pii` (55 types, 68M, via `rulesentry-io/ettin-68m-nemotron-pii-onnx` for browser ONNX).
- Runs **only on text Tier0 didn't resolve**.
- **Output is candidate list** `{type, span, context, confidence}` — **not auto-redaction**. A flagged name in page copy ≠ billing field; Ettin can't make that distinction.

### Tier 2 — Qwen 2B local reasoning (new, real scope)

- `Qwen/Qwen3.5-2B` (Apache 2.0) — adjudicates Tier1 ambiguous candidates using **surrounding context** (field, DOM role, page section, OCR confidence).
- Produces internal **Sanitization Plan** `{spans → [PERSON]/[EMAIL]/...}` — **never transmitted**.
- Local LLM integration (prompting/output-parsing), not a classifier call. **Discuss shared ownership with Person 2** (offscreen hosting overlap). See `QWEN_REDACTION_PIPELINE_PLAN.md` and `qwen_redaction_pure.mjs`.

### Deterministic Redaction (non-model)

- Executes Sanitization Plan: **DOM value replacement** (structure/IDs/classes/roles untouched) + **image-region masking** via bboxes from Person 2 (Sharp-equivalent, `REDACTION_STYLE=black|blur`).
- Structurally distinct from Tier2 judgment — model never touches pixels.

### Self-Audit (fail-closed)

- After redaction, **re-run Tier0+Tier1 on the OUTPUT payload** (not input). If still hit → **block payload + log**, no auto-retry.

### Other duties

- Password-field masking — always, outside tiering.
- **Face redaction gap:** PS says "blurring faces". Currently not in pipeline (text-only). Own decision with Person 2: add lightweight face model or declare **known limitation** in `limitations.md` + pitch.
- Rewrite redact-before-serialize guarantee to describe **plan/execute split** — stronger claim than single-pass.

## Files

- `piidetector.js` (Tier0)
- `qwen_redaction_pure.mjs` / `v3.mjs` (Tier1→Tier2→fusion → Qwen adjudication → Sharp)
- `extension/offscreen/offscreen.js` (Tier1/Tier2 hosting, co-owned)
- `QWEN_REDACTION_PIPELINE_PLAN.md`

## API

Candidates flow: `Tier0 residual → Ettin candidates → fuseRedactionCandidates (containment: ABC123XY98 > 98) → buildQwenRedactionEvidence → runQwenRedactionAdjudication → validate → safety gates → Sharp`.
