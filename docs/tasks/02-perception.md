# Person 2 — Perception Engineer (Jeet)

**Was:** On-Device Vision Engineer → **now:** Perception Engineer — three parallel extractors, not one VLM.

## What you build

`offscreen.html`/`offscreen.js` hosting **four** local models (DOM Extractor needs no model, but PaddleOCR, Florence-2-base, Ettin-68M, Qwen 2B all do). You own extractors; Person 3 owns Tier logic but shares offscreen hosting — coordinate.

### Concrete Tasks

1. **Offscreen host.** Set up `offscreen.js` to load all models via Transformers.js + ONNX Runtime Web (WebGPU with WASM fallback). Profile **memory/load time early** — 4 models is materially bigger than one. Decide with Person 1 + Person 3 on trigger lifecycle.

2. **DOM Extractor.** Native parsing: elements, attributes, ARIA labels, bboxes, relationships. No model. Lock output format with Person 1 first — do not assume bbox conventions match OCR/Florence automatically.

3. **PaddleOCR.** Authoritative OCR: `text`, `bbox` (absolute page coords), **`per-token confidence`** (0–1). Use `ppu-paddle-ocr` `V6_SMALL_MODEL`, `per-line` strategy, `minimumConfidence` 0.5. Confidence is **not optional metadata** — Tier0 (Person 3) depends on it to decide trust vs. escalate.

4. **Florence-2-base.** `onnx-community/Florence-2-base`, tasks: `<MORE_DETAILED_CAPTION>` (+ optional dense grounding). Browser/ONNX support is **experimental** — budget real time, agree fallback `DOM+OCR only (graceful degradation)` with Person 3 if it doesn't stabilize.

5. **Schema conformance.** All three outputs must match `docs/tool-schema.md` `list_interactive_elements` shape exactly: `{id, type, label, value:"[REDACTED:…]", bbox:[x1,y1,x2,y2], page_height, enabled}` — coordinate per-extractor.

6. **WebGPU + WASM fallback — test per-model separately.** Three models = three silent-divergence points.

7. **Benchmark on real demo page early** — individually and combined; don't assume 3× small = 1× small.

## Files

- `extension/offscreen/offscreen.html`
- `extension/offscreen/offscreen.js` (hosts PaddleOCR, Florence-2, delegates Ettin/Qwen to Person 3's pipeline but shares host)
- `perception/*` helpers (if extracted from `v3.mjs`)

## Fallback Contract with Person 3

If Florence fails to load (`Protobuf parsing failed`), return `{global_description: {error, skipped:true}}` and continue — pipeline must not block on Florence.
