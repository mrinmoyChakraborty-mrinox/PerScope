# PerScope — Local PII Detection & Image Redaction (Working Test Prototype)

Chrome MV3 extension + Node reference pipeline that detects personally identifying
information in screenshots/photos and redacts it **fully on-device** (WebGPU / WASM,
no cloud calls). This repo is a working test prototype: the extension in `dist/`
runs the complete pipeline locally, and `v7.mjs` is the Node reference implementation
the browser code maintains 1:1 algorithmic parity with.

Status: prototype under active testing. OCR, NER, face detection, fusion, safety gates,
and canvas redaction all run end-to-end; the FastVLM adjudication step is functional
with deterministic fallbacks when the model output fails validation.

**The image pipeline above is the tested foundation.** The bridge, DOM-native redaction,
and Playground described below are the locked next-phase plan built on top of it —
see **Section 7** for the full spec, current status of each piece, and what each
contributor should build next.

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

## 7. Next Phase (Locked Plan): Bridge, DOM Redaction, Playground

**Status: partially built (see per-subsection lines).** Everything in this section
is the locked design for the next three pieces of work, built on top of the tested
image pipeline above. Nothing here should be presented as working until it actually
is — mark PRs against the relevant subsection as they land, and update the status
lines below in the same commit.

### 7.1 Tech Stack (new components)

| Layer | Technology | Notes |
|---|---|---|
| Bridge process | Node.js, single long-running local process | Started by the user (or auto-started by an install script); not Chrome-spawned |
| Extension ↔ Bridge transport | WebSocket, `ws://127.0.0.1:<port>` | Origin-checked; one-time shared-secret pairing on first connect (secret shown in the dashboard, entered once) |
| Bridge ↔ Agent transport | MCP server, **dual transport**: stdio (for locally-spawned agents like Claude Code/OpenCode) and streamable-HTTP/SSE (for remote or browser-based agents) | Same tool-handler code behind both transports |
| MCP SDK | `@modelcontextprotocol/sdk` (Node) | Official SDK — tool schema, resource, transport plumbing |
| stdio entrypoint pattern | Thin proxy, not the bridge itself | The `npx @perscope/bridge mcp` command finds-or-spawns a detached singleton daemon (the actual WS server + extension pairing state), then proxies its own stdio JSON-RPC to that daemon. Prevents each agent client from spawning a conflicting extension-facing server, and keeps the daemon alive across agent sessions |
| Confirm-flow pattern | **Blocking tool call** — `click`/`type`/`submit` on a flagged element does not return until approved/denied/60s-timeout | No polling tool, no push/notification dependency |
| DOM extraction | `content.js`, `TreeWalker` over visible text nodes + form-control values (already sketched in the pasted `pii-detector.js`) | Injected on-demand, not persistently running |
| DOM PII detection | Ettin-68M NER (same ONNX model/session already used for OCR text) **+** the pasted regex/validator module as Signal 2 | Same fusion pattern as the image pipeline — parallel, not sequential |
| DOM redaction rendering | **Phase 1: text-level only** (`<EMAIL_ID>`-style placeholders in extracted text, DOM untouched) | Phase 2 (optional stretch): `Range.getClientRects()` overlay masks on a scoped demo page, `MutationObserver`-tracked |
| Playground reasoning backends | 3 interchangeable providers behind one interface — Local, Manual, Cloud | Detailed in §7.4 |
| Local reasoning model | TBD from: Llama-3.2-Vision-11B, Moondream2, PaliGemma-2 (VLM) *or* Llama-3.2-3B/Gemma-2 (LLM), served via Ollama or vLLM | Decision gated on §7.4.1 payload choice |
| Cloud reasoning backend | Same open-weight model as Local, hosted remotely (Together.ai / Fireworks / rented GPU + vLLM) | Not a different proprietary model — see §7.4.3 for why |

### 7.2 The Bridge

**Status: built — `@perscope/bridge@0.1.0` published on npm; role-aware multiplexing
(T1) implemented and tested in-repo, pending `0.2.0` release.** Daemon (paired WS
7331 + MCP HTTP 7332 + relay 7333 + dashboard + lockfile), `mcp` stdio-proxy
singleton, 9 tools, blocking confirm flow, pairing with agent/extension roles and
per-socket id remap. Downstream work runs the checkout daemon, never the stale
tarball.

**What it is:** one Node process with two faces. It is **zero-logic** by design — it
relays and formats messages, it never decides anything and never executes anything on
a page.

```text
                    ┌─────────────────────────┐
                    │        BRIDGE            │
                    │      (Node process)      │
   Extension  <───► │  WS server :port          │ ◄───►  MCP Client
  (background.js)   │  (extension-facing)       │       (Claude Code /
                    │                           │        OpenCode / Playground /
                    │  MCP server (stdio + HTTP)│        any MCP agent)
                    │  (agent-facing)           │
                    └─────────────────────────┘
```

**Extension ↔ Bridge (WebSocket)**
- Extension's `background.js` opens `ws://127.0.0.1:<port>` on startup.
- First connection: bridge shows a pairing code in its own local dashboard; user
  enters it once in the extension options page. Bridge stores the extension's secret;
  all further messages are signed/checked with it. This stops any other local process
  or malicious page from talking to the bridge.
- Same `{id, tool, params}` schema flows both directions — outbound capture events and
  evidence from the extension, inbound tool commands from the bridge.

**Bridge ↔ Agent (MCP) — tool schema:**

| Tool | Purpose |
|---|---|
| `capture_tab` | Trigger the existing image pipeline (OCR/NER/heuristics/FastVLM/redaction) on a tab, return evidence + redacted image |
| `read_page` | Trigger DOM extraction + text-redaction pipeline (§7.3), return sanitized structured content |
| `list_interactive_elements` | Enumerate clickable/typeable elements with stable references |
| `click` / `type` / `select_option` / `submit` / `scroll` | Execute an action via `content.js`, gated by `isDestructive()` |

Both stdio and HTTP transports are wired to the same handler functions — no divergent
logic between "a locally spawned agent" and "a remote/browser agent."

**The validator boundary:** `isDestructive()` lives in the **extension**, immediately
in front of `content.js`. The bridge cannot bypass it, and it does not care whether the
calling `{id, tool, params}` came from a real MCP agent, the Playground's local model,
the Playground's manual mode, or a cloud model — same check, same code path, every
time. This is the load-bearing security property; everything else is designed so it
stays true without exceptions.

**Confirm flow (blocking call):**
```text
Agent → Bridge → Extension: click(element_X)
Extension: isDestructive(element_X)?
  NO  → execute via content.js → return {status:"ok"}
  YES → show Approve/Deny in side panel
        → tool call blocks (up to 60s)
        → human approves → execute → return {status:"ok"}
        → human denies    → return {status:"denied"}
        → 60s elapses     → return {status:"timeout"}
```
No polling tool, no dependency on the MCP client supporting server push — works with
any MCP client because it's just a normal (if slow) tool response.

**Agent-side setup, once the bridge is published to npm:**
```bash
# Claude Code
claude mcp add perscope -- npx -y @perscope/bridge mcp

# OpenCode (opencode.json)
{ "mcp": { "perscope": { "type": "local", "command": ["npx", "-y", "@perscope/bridge", "mcp"] } } }
```

### 7.3 DOM-Native Redaction (Phase 1)

**Status: Tier0 capture + read_page + list_interactive_elements wired; actions pending.**
`content/dom-capture-entry.js` (auto-injected, all frames) walks text/attribute/form
segments with Tier0-per-segment redaction (tested, DOM never mutated);
`read_page` and `list_interactive_elements` (opaque `ref` registry with live
re-resolution, `stale_element` only on genuine mismatch) route over the bridge.
Label→value association (same-line / neighbor / table, value-only) is in.
Still pending: `click`/`type`/`select_option`/`submit`/`scroll` execution,
`isDestructive()` wiring, approval UI, `list_tabs` titles check live.

```text
content.js: extractDOMText() + extractFormValues()
        |
        v
    DOM text (+ per-node context: aria-label, <label for>, placeholder, name)
        │
        ├──► Ettin-68M NER              (Signal 1, same model/session as image path)
        └──► pii-detector.js regex+validator   (Signal 2 — Luhn/IBAN/IPv4 already built in)
        │
        v
    Fusion — merge by character-offset overlap (image path merges by OCR-id;
             this is the DOM equivalent of the same function)
        │
        v
    Safety gates — same shape as image path, but no FastVLM proposal to
                   validate by default (see below)
        │
        v
    Text-level redaction — <EMAIL_ID>-style placeholders in the extracted
                            text. Live DOM is NOT modified.
        │
        v
    Sanitized structured output → feeds read_page (agent mode) and
                                   Send-to-Chat (human mode)
```

Why text-only, not a DOM overlay, for Phase 1: `read_page` (agent mode) and
Send-to-Chat (human mode) both want sanitized **text**, not a visually altered page;
editing live text nodes risks breaking React/Vue/Angular re-renders and controlled
inputs (the pasted module's own comments already flag this); overlay-based visual
masking is real engineering risk close to deadline and is scoped as an **optional
Phase 2 stretch goal** on a small set of chosen demo pages only.

Adjudication is **off by default** for DOM mode: `read_page` is called repeatedly
inside an agent's task loop, so a model call on every read is the single biggest
latency risk in the system. DOM-native context (`aria-label`, `<label for>`,
`placeholder`, `name`) feeds `calculateConfidence()`'s existing context-word boost
directly, at zero model cost. A `FASTVLM_FOR_DOM` flag stays in the codebase as an
explicit, honest opt-in.

### 7.4 The Playground

**Status: Manual side WS leg built (T2–T8 slice); chat/model backends deferred.**
The playground talks to the bridge directly — WS agent leg (paired, blocking calls,
70s ceilings) and MCP leg proven; Manual side (tab picker via new `list_tabs`,
generic tool sender, `capture_tab` rendering, pairing UI) works against the real
runtime; mock server retired to explicit-only. Still pending: chat-side model loop
(T6, PS-required Server Side Integration), MCP-show demo scripts (T4), approval UI.
All three backends implement the identical
contract, so the extension and bridge never know or care which is active:

```text
input:  sanitized context (redacted image + evidence, and/or DOM text output)
        + tool schema
output: { tool, params }  |  { status: "final", message }
```

**7.4.1 Payload:** redacted image + evidence object (not just a text summary) for
image-mode tasks, sanitized structured text for DOM-mode tasks.

**7.4.2 Local backend:** a small open-weight VLM served locally via Ollama or vLLM
(candidate: Moondream2 or a Llama-3.2-Vision variant), reasoning directly over the
redacted image + evidence.

**7.4.3 Cloud backend:** the same open-weight model, hosted remotely (Together.ai /
Fireworks / rented GPU running the identical vLLM/Ollama setup) — not a different
proprietary API. Matches the PS text: cloud hosting of an open-weight model is
permitted as a hosting convenience, not a different model.

**7.4.4 Manual mode:** a person is shown the same Capture Review screen (Visual view +
Context view) a model would see, picks a tool from the schema, fills or free-types
`{id, tool, params}`, and submits through the exact same bridge ingress a real agent or
model uses. Doubles as the integration test harness and the demo fallback.

### 7.5 End-to-End Workflows

**A real user, with their own AI coding agent (Claude Code / OpenCode / any MCP
client):** install extension → start bridge locally → pair once (§7.2) → point MCP
client at the bridge (stdio for a locally-spawned agent, HTTP URL for a remote one) →
agent calls `capture_tab` / `read_page` / `list_interactive_elements` as part of its
own reasoning, never seeing raw sensitive data → any `click`/`type`/`submit` blocks on
`isDestructive()` until auto-cleared or a human approves/denies in the side panel.

**The full human workflow (no agent installed):** popup → pick tab → Capture → live
progress (captured → extracted → detected → sanitizing) → Capture Review screen
(Visual view + Context view, outcome state Clean / Ambiguous / Blocked) → pick
destination tab → Send (inject only) or Send & Submit (inject + auto-submit, opt-in) →
sanitized content wrapped in an explanatory preamble before it lands in the
destination chat.

**Our own demo, using the Playground:** presenter picks a backend from the provider
selector (Local / Cloud / Manual) → runs an end-to-end task through
`capture_tab`/`read_page` → redacted context → reasoning backend proposes a tool call →
`isDestructive()` gate → side-panel approve if flagged → action executes. Switching
backends mid-demo is just the dropdown — bridge, validator, and extension code paths
are identical underneath, so Local vs Cloud can be re-run back-to-back to make the
latency/accuracy tradeoff concrete.

### 7.6 Explicitly Deferred / To State Honestly If Asked

- DOM overlay visual masking (Phase 2) — stretch goal, scoped demo pages only.
- Native Messaging for extension↔bridge — WebSocket ships first; Native Messaging is a
  post-MVP hardening item.
- Multimodal adjudication for DOM mode — toggle (`FASTVLM_FOR_DOM`), off by default.
- Output-level self-audit re-scan vs. relying on caption scrubbing alone — still open.

### 7.7 Who Builds What

| Owner | Scope |
|---|---|
| Bridge dev | `@perscope/bridge` npm package: WS server + pairing, MCP server (stdio + HTTP, via SDK), stdio proxy-to-daemon entrypoint, tool schema handlers, blocking confirm-flow plumbing |
| Extension dev | `background.js`: WS client to the bridge, pairing-code UI in options page, `{id, tool, params}` message handling on the extension side, wiring `isDestructive()` + side-panel Approve/Deny into the confirm flow; `content.js`: DOM extraction (`extractDOMText`/`extractFormValues`) and validated action execution (`click`/`type`/`submit`/`scroll`) — currently absent, net-new |
| PII/pipeline dev | Wire Ettin NER + `pii-detector.js` into a DOM-mode fusion path (character-offset merge, mirroring `heuristics.js`'s OCR-id merge); DOM-native context signals for `calculateConfidence()` |
| Playground dev | Provider-selector UI, Local backend (Ollama/vLLM + model), Cloud backend (same model, remote host), Manual mode UI reusing the Capture Review screen |
