# PerScope — Local PII Detection & Image Redaction (Working Test Prototype)

Chrome MV3 extension + Node reference pipeline that detects personally identifying
information in screenshots/photos and redacts it **fully on-device** (WebGPU / WASM,
no cloud calls). This repo is a working test prototype: the extension in `dist/`
runs the complete pipeline locally, and `v7.mjs` is the Node reference implementation
the browser code maintains 1:1 algorithmic parity with.

Status: prototype under active testing. OCR, NER, face detection, fusion, safety gates,
and canvas redaction all run end-to-end; the FastVLM adjudication step is functional
with deterministic fallbacks when the model output fails validation.

## 1. Overview

Given an input image (file upload or visible-tab capture), PerScope:

1. Detects faces (BlazeFace) and OCR text regions (PaddleOCR PP-OCRv6-small).
2. Extracts PII signals three ways: Ettin NER (transformer token classification),
   deterministic label/regex heuristics, and FastVLM-0.5B multimodal adjudication.
3. Fuses the signals into redaction candidates with confidence scores and sources.
4. Resolves each candidate to a **value-only** bounding box (never whole label+value lines).
5. Renders the redacted image (blur or black-box) on canvas and returns it plus a
   machine-readable evidence object (findings, bboxes, caption, timings, device info).

Privacy design: raw model text is never trusted. Captions are deterministically
scrubbed of every known sensitive value before reaching evidence or UI, and geometry
resolution rejects any box that is not value-specific.

## 2. Tech Stack

### 2.1 Runtime & libraries

| Component | Technology |
|---|---|
| Extension shell | Chrome MV3: popup, background service worker, offscreen document, dashboard/options page |
| Bundler | esbuild (browser ESM, `build.mjs`); MV3 CSP patched to load ORT WASM from `chrome.runtime.getURL("ort/")` instead of CDN |
| ONNX inference (browser) | `onnxruntime-web` + `@huggingface/transformers` v4 (WebGPU EP pinned per model; single-thread WASM fallback) |
| ONNX inference (Node) | `onnxruntime-node` path via transformers.js with `auto`/`webgpu`/`cpu`/`wasm`/`dml`/`cuda` device selection (Windows DirectML supported) |
| OCR engine | `ppu-paddle-ocr` v6 (PP-OCRv6-small detector + recognizer) |
| Image ops (Node) | `sharp` (resize, test output); browser uses `OffscreenCanvas` / `createImageBitmap` |
| Checks | `tests/run-checks.mjs` (`npm run check`): dist structure, no Node-only imports in bundles, MV3 manifest validation |

### 2.2 Models (all local, all ONNX)

| # | Model | HF repo / source | Role | Variant in use | Approx. size | Execution |
|---|---|---|---|---|---|---|
| 1 | PaddleOCR PP-OCRv6-small | `snowfluke/ppu-paddle-ocr-models` (see `models/model-manifest.json` for URLs + sha256) | Text detection + recognition. Recognition runs **per-box** (`strategy: "per-box"`, `minimumConfidence: 0.5`) — more robust than per-line when detection boxes shift between canvas backends | `PP-OCRv6_small_det.ort` + `PP-OCRv6_small_rec.ort` + dict | det ~10 MB, rec ~21 MB | Browser: WASM EP. Bundled at `dist/models/paddleocr/` |
| 2 | Ettin 68M Nemotron PII | `rulesentry-io/ettin-68m-nemotron-pii-onnx` | NER token classification over OCR text (BIO labels → entity spans → OCR-region mapping). fp32, `model_file_name: "model"`, 512 max tokens, min score 0.3 | `model.onnx` (+ `model_q4.onnx` present in repo copy) | ~274 MB (+274 MB q4 copy) | WebGPU EP pinned; single-thread WASM (`intra/interOp: 1`) CPU fallback. The int64-encoder-input crash on threaded WASM is why the EP is pinned, not left to auto |
| 3 | FastVLM-0.5B | `onnx-community/FastVLM-0.5B-ONNX` | Multimodal adjudicator: sees screenshot + OCR/fused evidence, returns JSON `{ caption, redactions, additional_redactions, rejected_candidates }`. Greedy decode, `max_new_tokens: 512`, `repetition_penalty: 1.15`, `no_repeat_ngram_size: 3` | `embed_tokens_fp16` + `vision_encoder_q4f16` + `decoder_model_merged_q4f16` (~780 MB total). Switchable to plain `q4` via `VARIANT=q4` download script (vision q4 is ~482 MB — barely smaller than fp32) | ~780 MB | WebGPU EP pinned; WASM CPU retry. Images resized to max 672 px before inference |
| 4 | BlazeFace | `garavv/blazeface-onnx` (`blaze.onnx`) | Face detection → 128×128 planar NCHW RGB input, NMS (IoU 0.3, max 25, min conf 0.6) | `blaze.onnx` | ~0.5 MB | WASM EP by default (fast and stable); WebGPU optional |

Retired/superseded entries still present in `models/` and `model-manifest.json`
(Florence-2-base, Qwen3.5-2B) are **not** in the active pipeline — FastVLM-0.5B
replaced both the old visual-perception and text-adjudication models.

### 2.3 Model sourcing

- Browser (slim): small models bundled; Ettin + FastVLM download on first run from
  HuggingFace and are cached by the browser (`env.useBrowserCache`, `env.allowLocalModels`,
  `env.localModelPath = chrome.runtime.getURL("models/")`).
- Browser (full-offline): `INCLUDE_BIG_MODELS=1 npm run build` bundles Ettin
  (`models/ettin-68m-nemotron-pii-onnx`) and FastVLM
  (`node_modules/@huggingface/transformers/.cache/onnx-community/FastVLM-0.5B-ONNX`
  → `dist/models/onnx-community/FastVLM-0.5B-ONNX`). The extension probes the local
  path first (`resolveNERModelPath` HEAD-check pattern; transformers.js
  `localModelPath + modelId` probing for FastVLM).
- `scripts/download-fastvlm-q4f16.mjs` fetches exactly the needed FastVLM file set
  (3 weight files + 10 config/tokenizer files, byte-size verified, resume-safe skips).
  `VARIANT=q4 node scripts/download-fastvlm-q4f16.mjs` fetches the plain-q4 pair instead.
  Must match `FASTVLM_DTYPE` in `v7.mjs` / `src/pipeline/v7-extension.js`.

## 3. Architecture

### 3.1 Extension contexts

```text
popup.html / dashboard.html (UI: upload, capture tab, device tier, style toggles,
                             progress steps, original/redacted/bbox-overlay views,
                             caption + evidence + prompt inspectors, PNG/JSON export)
        |  chrome.runtime messages (imageBytes as number array; progress events)
        v
background/service-worker.js (offscreen-document lifecycle, CAPTURE_VISIBLE_TAB)
        |
        v
offscreen.html + offscreen.js (owns WebGPU adapter, ORT, pipeline; idle pre-warm
        |  of NER + FastVLM; returns redacted PNG as base64 to avoid JSON
        v  serialisation blow-up)
src/pipeline/v7-extension.js  <-- main pipeline (browser port of v7.mjs)
  gpu.js              device tiers: dedicated GPU -> integrated GPU -> CPU/WASM
  face.js             BlazeFace session + NMS
  heuristics.js       reading order, OCR global spans, deterministic candidates,
                      fusion, value sub-bbox estimation, geometry validation
  ner-utils.js        BIO decode, softmax, token->char offset mapping
  prompts.js          FastVLM evidence builder + redaction prompt
  safety.js           JSON extraction/validation, safety gates,
                      adjudicateOrFallback, redactChunks, sanitizeCaption
  canvas-redactor.js  blur / black-box rendering on OffscreenCanvas
```

### 3.2 Pipeline stages (`runExtensionPipeline`, mirrored in `v7.mjs`)

```text
INIT -> DEVICE (resolveComputeDevice, configureOrtEnvironment)
  -> IMAGE_DECODE -> FACE (BlazeFace, optional)
  -> OCR (PaddleOCR per-box, conf >= 0.5)
  -> NER (Ettin over OCR text, placeholder filtering)
  -> HEURISTICS (deterministic label dictionaries: DOB, phone, email,
                 IDs, account/UPI/IFSC/IBAN... + fuseRedactionCandidates +
                 buildUIStructure + FastVLM evidence assembly)
  -> FASTVLM (prompt + image -> JSON adjudication; strict validation,
              fusion_fallback on parse/validation failure)
  -> ADJUDICATION (safety gates -> finalTextFindings + faceFindings)
  -> REDACT (canvas blur/black-box with padding; redacted OCR text)
  -> evidence output { input_mode, compute_device, image, global_description,
     florence{description}, findings, redacted text, timings }
```

### 3.3 Key algorithms (prototype detail)

- **Reading order & span mapping**: OCR items are clustered into rows by y-center,
  sorted top-to-bottom / left-to-right; each region is mapped to global char offsets
  with cursor-based sequential matching so duplicate labels resolve correctly.
- **Fusion**: deterministic and NER candidates merge on overlapping OCR ids/text;
  each fused candidate keeps `candidate_types`, `sources`, `confidence`, `ocr_ids`.
- **Value-only geometry** (`resolveSensitiveValueBBox`): exact text match → full OCR
  box; substring match → proportional character-based sub-box with whole-line guards
  (`isLikelyValueOnlyBBox`); otherwise reject. Fused bboxes are only trusted when proven
  value-specific. This is the single chokepoint for all redaction geometry.
- **Safety gates** (`applySafetyGates`, `adjudicateOrFallback`): FastVLM-proposed
  redactions must reference real fused `candidate_id`s / OCR ids and pass type
  allowlists; failures degrade to `fusion_fallback`, never to blind trust.
- **Caption scrubbing** (`sanitizeCaption`): every known sensitive value (including
  digit-compact variants like spaced vs unspaced number runs) is replaced with
  `[REDACTED:TYPE]`; issuer/layout words (country, org, gender) are allowlisted so
  descriptions stay useful; repetition loops are deduped and output is capped at a
  clean sentence boundary. The caption prompt additionally forbids values, category
  lists, policy talk, and refusals.
- **Transfer protocol**: popup→offscreen sends bytes as `Array<number>` (structured
  clone safety); offscreen→UI returns base64 PNG (~4× smaller / ~10× faster than a
  JSON number array).

## 4. Build Variants & Testing

```bash
npm install
npm run build                          # slim: paddleocr + blazeface bundled (~150 MB zip).
                                       # Ettin + FastVLM download on first run.
INCLUDE_BIG_MODELS=1 npm run build     # full-offline: everything bundled (~1.2 GB zip).
npm run check                          # verify dist (structure, no node: imports, MV3 manifest)
node scripts/download-fastvlm-q4f16.mjs            # fetch q4f16 FastVLM set into HF cache
VARIANT=q4 node scripts/download-fastvlm-q4f16.mjs  # fetch plain-q4 set instead
```

Load testing: `chrome://extensions` → Developer mode → Load unpacked → `dist/`
(or unzip a build). Test images in repo root: `s4.png` (ID-card style document),
`s5.jpg` (person photo). Useful console markers: `[OCR-DEBUG]`, `[NER]`,
`[HEURISTICS]`, `[FASTVLM-DEBUG] sessions:` (should list `embed_tokens`,
`vision_encoder`, `decoder_model_merged` — a missing `vision_encoder` means blind
text-only inference), `[ADJUDICATION]`, `[FASTVLM] JSON parse failed`.

Node reference: `node v7.mjs` (same test image). FastVLM knobs via env:
`FASTVLM_ENABLED / ENABLE_FASTVLM`, `FASTVLM_MODEL`, `FASTVLM_DEVICE`
(`auto|webgpu|cpu|wasm|dml|cuda|gpu`), `FASTVLM_MAX_NEW_TOKENS` (default 512),
`FASTVLM_REQUIRED`, `FASTVLM_TIMEOUT_MS`, `FASTVLM_MAX_IMAGE_SIZE` (default 672),
`FASTVLM_RESIZE_ENABLED`, `DML_DEVICE_ID` (Windows hybrid-GPU selector).
Node persists the raw model output to `fastvlm_output.txt` and the rendered prompt
to `fastvlm_redaction_prompt.txt`; `perception_evidence.json` holds sample evidence.

Current artifacts: `perscope-extension-slim.zip` (~153 MB),
`perscope-extension-full.zip` (~1.18 GB). `session-*.md` files are dev session logs,
not documentation. `patches/` holds `patch-package` fixes (`ppu-ocv` runtime-init,
`ppu-paddle-ocr` engine handling) applied on install.

## 5. Repo Layout

```text
v7.mjs                      Node reference pipeline (~5000 lines, 1:1 with extension)
src/pipeline/               v7-extension.js (browser pipeline), gpu.js, face.js,
                            heuristics.js, ner-utils.js, prompts.js, safety.js,
                            canvas-redactor.js
src/offscreen/              offscreen.html + offscreen.js (ML host)
src/background/             service-worker.js (offscreen lifecycle, tab capture)
src/popup/                  popup UI (upload/capture, progress, results, export)
src/app/                    dashboard (device telemetry, caption/evidence/prompt panes)
models/                     paddleocr, blazeface, ettin-*-onnx, manifest files
                            (florence-2-base, qwen3.5-2b present but inactive)
scripts/                    download-fastvlm-q4f16.mjs, check-scope.mjs,
                            create-pipeline-modules.mjs
tests/                      run-checks.mjs (npm run check), pipeline.test.mjs
patches/                    patch-package patches for ppu-ocv, ppu-paddle-ocr
build.mjs / manifest.json / package.json
s4.png / s5.jpg             test images (document, person photo)
```

## 6. Known Limitations (prototype)

- FastVLM-0.5B is small: captions/adjudication can be bland or miss JSON schema;
  the pipeline is designed to survive that (validation → fusion fallback → still
  redacts via OCR/NER/heuristics), but output richness is bounded by model capacity.
- Deterministic heuristics can over-redact (e.g. a number row inheriting a nearby
  "DOB" label context) — safe direction, fusion/validators narrow it where possible.
- WASM fallback is single-threaded by necessity (int64 inputs crash the threaded
  WASM build); CPU inference of the big models is slow.
- `tests/run-checks.mjs` still references a legacy `models/FastVLM-0.5B-ONNX` check
  path; the real full-offline path is `models/onnx-community/FastVLM-0.5B-ONNX`.
