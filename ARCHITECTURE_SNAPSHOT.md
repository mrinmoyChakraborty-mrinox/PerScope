# ARCHITECTURE_SNAPSHOT.md — Ground-truth state of the extension

> Read-only snapshot. Every claim below was verified by reading the files on disk on
> 2026-09-25. Where the README or a prior task doc disagrees with disk, the
> disagreement is called out as an explicit **Discrepancy**. Where code cannot answer
> something, it says **unclear from code** instead of guessing.
>
> Constraint honored: this task created exactly one new file and modified no source.

---

## 0. Where the real code lives (read this first)

The task brief assumes repo-root `src/`, `models/`, `scripts/`, `tests/`, `patches/`,
and a root `build.mjs`. **None of those exist at the repo root.** The real extension
is `extension/v7 beta/`, which contains its own `src/`, `models/`, `scripts/`,
`tests/`, `patches/`, `build.mjs`, `manifest.json`, `package.json`, `v7.mjs`, and
`dist/`. Repo root instead holds: `extension/`, `bridge/`, `server/`, `playground/`,
`docs/`, `Landing_page/`, plus loose files (`piidetector.js`, `v3.mjs`,
`qwen_redaction_pure.mjs`, `QWEN_REDACTION_PIPELINE_PLAN.md`, `session-ses.md`).

**Discrepancy:** top-level `extension/background/background.js`,
`extension/content/content.js`, `extension/offscreen/offscreen.js`,
`extension/popup/index.js`, and `extension/manifest.json` are each a **one-line
stub** of the form `// Owned by: <other person> — see /docs/tasks/... Not
implemented here.` All live behavior is in `extension/v7 beta/src/`. Anyone wiring
against `extension/*` directly will find nothing to wire to.

---

## 1. Directory tree (actual, not the README's version)

### Repo root (actual)

```text
PERSCOPE/
  extension/
    background/background.js      <- 1-line stub (Extension/Automation owner)
    content/content.js            <- 1-line stub
    dashboard/index.js            <- (not read; same stub pattern expected)
    manifest.json                 <- 1-line stub, NOT a manifest
    offscreen/offscreen.js        <- 1-line stub
    popup/index.js                <- 1-line stub
    sidepanel/index.js            <- (not read; same stub pattern expected)
    v7 beta/                      <- THE REAL EXTENSION (see below)
  bridge/src/                     config.js daemon.js lockfile.js mcp-server.js
                                  mcp-stdio-proxy.js pairing.js version.js
                                  ws-server.js tools/
  server/index.js
  playground/{js,ui}/
  docs/tasks/                     01-lead-integration.md 02-perception.md
                                  03-privacy-redaction.md 04-extension-automation.md
                                  05-person5-playground-chat-rework.md
                                  05-server-bridge-playground.md 06-research-qa.md
                                  PERSON4_HANDOVER_Shritama.md PERSON5_HANDOVER.md README.md
  piidetector.js                  <- Koyel's Tier0 (root level, NOT under src/)
  tests/qwen_regression.test.mjs  <- root test (qwen_redaction_pure.mjs harness)
  qwen_redaction_pure.mjs  v3.mjs
```

### `extension/v7 beta/src/` (actual)

```text
src/
  popup/popup.{html,css,js}
  background/service-worker.js
  offscreen/{offscreen.html, offscreen.js, bridge-link.js}
  content/dom-capture-entry.js          <- the only content script source
  app/dashboard.{html,css,js}
  pipeline/{v7-extension.js, gpu.js, face.js, heuristics.js, ner-utils.js,
            prompts.js, safety.js, canvas-redactor.js,
            dom-capture.js, dom-heuristics.js}
  shared/is-destructive.js
```

### `extension/v7 beta/models/` (actual)

```text
models/
  ATTRIBUTIONS.md  manifest.json  model-manifest.json
  paddleocr/  blazeface/
  ettin-68m-nemotron-pii-onnx/  ettin-68m-nemotron-pii/
  florence-2-base/  qwen3.5-2b/     <- present but inactive (see §6)
```

### `extension/v7 beta/scripts/`, `tests/`, `patches/` (actual)

```text
scripts/  check-scope.mjs  create-pipeline-modules.mjs  download-fastvlm-q4f16.mjs
tests/    run-checks.mjs  pipeline.test.mjs  dom-capture.test.mjs  is-destructive.test.mjs
patches/  ppu-ocv+4.0.0.patch  ppu-paddle-ocr+6.6.0.patch
```

### README §5 vs disk

- README §5 claims `src/offscreen/offscreen.html + offscreen.js (ML host)`,
  `src/background/service-worker.js`, `src/popup/`, `src/app/dashboard`,
  `src/pipeline/{...8 image-pipeline modules...}` — **all match disk**.
- README §5 does **not** mention `src/content/dom-capture-entry.js`,
  `src/pipeline/dom-capture.js`, `src/pipeline/dom-heuristics.js`,
  `src/shared/is-destructive.js`, or `src/offscreen/bridge-link.js` — **all exist
  on disk but are absent from the README layout**. (They are covered by README §7
  as "not started" plan items, which is itself stale — see §8.)
- README §5 claims `build.mjs / manifest.json / package.json` at a top level that
  reads like repo root; on disk they live under `extension/v7 beta/`. There is no
  root `build.mjs`, no root `src/`, no root `models/`.

---

## 2. Extension contexts — what each actually does

Sources: `extension/v7 beta/src/{popup/popup.js, background/service-worker.js,
offscreen/offscreen.js, offscreen/bridge-link.js, content/dom-capture-entry.js,
app/dashboard.js}`.

### Popup (`src/popup/popup.js`, 524 lines)

- **Imports:** none (vanilla DOM script,uses `chrome.*` globals only).
- **Owns:** image input (upload / drop / paste / tab-capture buttons), the
  processing stepper UI, the image-results view (redacted/original/overlay,
  caption, stats, PNG/JSON export), and the **DOM-results view**
  (`domResultsSection`, per-type finding chips, DOM evidence download).
- **Triggers:** on load sends `ENSURE_OFFSCREEN` then `GET_DEVICE_INFO` to
  offscreen (`popup.js:71-78`); `btnCaptureTab` → `CAPTURE_VISIBLE_TAB`
  (`popup.js:155-171`); file/paste → `RUN_PIPELINE` with `Array<number>`
  imageBytes (`popup.js:173-218`); `btnCaptureDomText` → `REQUEST_DOM_CAPTURE`
  (`popup.js:358-384`); listens for `PIPELINE_PROGRESS` with `target:"ui"`
  (`popup.js:221-227`); `refreshBridgeLabel()` polls `BRIDGE_STATUS`
  (`popup.js:514-524`).

### Background / service worker (`src/background/service-worker.js`, 165 lines)

- **Imports:** none (bare MV3 worker).
- **Owns:** offscreen-document lifecycle (`ensureOffscreenDocument`,
  `service-worker.js:19-36`, onInstalled/onStartup) and the action badge color
  for bridge state (`updateBridgeBadge`, `:147-165`).
- **Triggers / routes:** `onMessage` handler (`:48`) gated on
  `message.target === "background"`. Handles `CAPTURE_VISIBLE_TAB` (`:51-60`),
  `REQUEST_DOM_CAPTURE` (`:69-88`, forwards to tab via `chrome.tabs.sendMessage`
  — see §3), `ENSURE_OFFSCREEN` (`:90-95`), `BRIDGE_STATUS_UPDATE` (`:103-106`,
  badge only), `BRIDGE_STATUS` / `BRIDGE_PAIR` (`:108-138`, relay to offscreen).

### Offscreen (`src/offscreen/offscreen.js`, 191 lines + `bridge-link.js`, 260 lines)

- **Imports:** `resolveComputeDevice` from `../pipeline/gpu.js`,
  `runExtensionPipeline` from `../pipeline/v7-extension.js`, `startBridgeLink`
  from `./bridge-link.js` (`offscreen.js:13-15`).
- **Owns:** WebGPU/ORT environment, the whole image pipeline invocation
  (`runPipelineJob`, `:53-73`), base64 output encoding, the bridge WebSocket
  client (in `bridge-link.js`: `ws://127.0.0.1:7331`, pair/hello handshake,
  reconnect with backoff, token in `chrome.storage.local`), and progress fan-out
  (`PIPELINE_PROGRESS` → `target:"ui"`, `:150-156`).
- **Triggers:** idle pre-warm via `requestIdleCallback` → dynamic import of
  `v7-extension.js` → `_prewarmModels()` (`offscreen.js:36-48`); serves
  `GET_DEVICE_INFO`, `RUN_PIPELINE`, `BRIDGE_STATUS`, `BRIDGE_PAIR`
  (`:139-188`); `capture_tab` bridge tool reuses the exact popup pipeline path
  (`:90-118`).
- **Diagram check:** README §3.1 shows background → offscreen → pipeline with
  popup↔offscreen byte/base64 protocol. **Matches disk**, with two additions the
  diagram omits: (a) the bridge WebSocket client lives in offscreen (not
  background — deliberate, because MV3 workers kill sockets; see
  `bridge-link.js:1-19`), and (b) the DOM-capture content-script path, which
  bypasses offscreen entirely (popup → background → tab).

### Content script (`src/content/dom-capture-entry.js`, 225 lines)

- **Imports:** `captureDOMSegments`, `runTier0OnSegments` from
  `../pipeline/dom-capture.js`; `reconstructDocument` from
  `../pipeline/dom-heuristics.js`; `detectPII`, `redactPII` from root
  `../../../../piidetector.js` (`dom-capture-entry.js:22-28`).
- **Owns:** nothing persistent. Handles exactly one message type
  (`CAPTURE_DOM_TEXT`, `:184-225`); top frame aggregates (own walk +
  `window.postMessage` collect channel to cross-origin frames, 900 ms timeout,
  `:71-151`), child frames answer the collect channel (`:155-181`).
- **Triggers:** `chrome.tabs.sendMessage(tabId, {type:"CAPTURE_DOM_TEXT"})` from
  background; never runs unprompted; **never mutates the DOM**.

### Dashboard (`src/app/dashboard.js`, 330 lines)

- Same pipeline-caller shape as popup (upload/drop/capture → `RUN_PIPELINE` →
  base64 decode → overlay/caption/evidence/prompt panes), plus device telemetry
  and bridge pairing UI (`BRIDGE_STATUS` poll every 5 s, `BRIDGE_PAIR` submit;
  `dashboard.js:294-330`).

---

## 3. Full message-passing catalog

`chrome.tabs.sendMessage` is used once (background → tab). Everything else is
`chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. No `RUN_ETTIN_NER`
message type exists anywhere in `src/` (grep over `src/**/*.js` returns zero
hits) — **the Ettin/NER gap is still a gap**; NER is reachable only inside the
offscreen image pipeline, never as a standalone message.

| message type (`action` or `type`) | sender → receiver | payload shape | response shape | file:line |
|---|---|---|---|---|
| `CAPTURE_VISIBLE_TAB` (`action`, `target:"background"`) | popup → background; dashboard → background; offscreen (bridge `capture_tab`) → background | `{target:"background", action}` | `{status:"SUCCESS", dataUrl} \| {status:"ERROR", error}` | sender `src/popup/popup.js:157-160`, `src/app/dashboard.js:109`, `src/offscreen/offscreen.js:100`; handler `src/background/service-worker.js:51-60` |
| `REQUEST_DOM_CAPTURE` (`action`, `target:"background"`) | popup → background | `{target:"background", action}` | `{status:"SUCCESS", capture} \| {status:"ERROR", error}` | sender `src/popup/popup.js:370-373`; handler `src/background/service-worker.js:69-88` |
| `CAPTURE_DOM_TEXT` (`type`, tabs message) | background → active tab top frame (content script) | `{type:"CAPTURE_DOM_TEXT"}` | `{status:"SUCCESS", capture:{capturedAt, frameCount, segmentCount, redactedDocument, findings[], skipped}} \| {status:"ERROR", error}` | sender `src/background/service-worker.js:77`; handler `src/content/dom-capture-entry.js:184-225` |
| `ENSURE_OFFSCREEN` (`action`, `target:"background"`) | popup / dashboard → background | `{target:"background", action}` | `{status:"SUCCESS"} \| {status:"ERROR", error}` | senders `src/popup/popup.js:71,199`, `src/app/dashboard.js:52,145`; handler `src/background/service-worker.js:90-95` |
| `GET_DEVICE_INFO` (`action`, `target:"offscreen"`) | popup / dashboard → offscreen | `{target:"offscreen", action, forceTier}` | `{status:"SUCCESS", device} \| {status:"ERROR", error}` | senders `src/popup/popup.js:74-78`, `src/app/dashboard.js:53-57`; handler `src/offscreen/offscreen.js:139-144` |
| `RUN_PIPELINE` (`action`, `target:"offscreen"`) | popup / dashboard → offscreen | `{target:"offscreen", action, jobId, imageBytes:Array<number>, options}` | `{status:"SUCCESS", jobId, outputBase64, evidence, perceptionPrompt, computeDevice, totalTimeMs} \| {status:"ERROR", jobId, error, stack}` | senders `src/popup/popup.js:201-207`, `src/app/dashboard.js:146-152`; handler `src/offscreen/offscreen.js:146-174` |
| `PIPELINE_PROGRESS` (`action`, `target:"ui"`) | offscreen → popup/dashboard (broadcast) | `{target:"ui", action, jobId, progress:{stage, status, ...}}` | no response (listener filters by `jobId`) | sender `src/offscreen/offscreen.js:150-156`; listeners `src/popup/popup.js:221-227`, `src/app/dashboard.js:167-171` |
| `BRIDGE_STATUS_UPDATE` (`action`, `target:"background"`) | offscreen → background | `{target:"background", action, status:{connected, paired}}` | none (`return false`) | sender `src/offscreen/offscreen.js:133`; handler `src/background/service-worker.js:103-106` |
| `BRIDGE_STATUS` (`action`, `target:"background"` then `target:"offscreen"`) | popup/dashboard → background → offscreen | `{target, action}` | `{status:"SUCCESS", bridge:{connected, paired, ...}}` | senders `src/popup/popup.js:518`, `src/app/dashboard.js:299`; SW relay `src/background/service-worker.js:108-120`; offscreen `src/offscreen/offscreen.js:177-180` |
| `BRIDGE_PAIR` (`action`, `target:"background"` then `target:"offscreen"`) | popup/dashboard → background → offscreen | `{target, action, code}` | `{status:"SUCCESS", ok, reason?}` | senders `src/app/dashboard.js:313`; SW relay `src/background/service-worker.js:122-138`; offscreen `src/offscreen/offscreen.js:182-188` |
| bridge WS `pair/hello/tool` | offscreen `bridge-link.js` ↔ `@perscope/bridge` WS server | `{type:"pair",code}→{type:"paired",clientId,token}`; `{type:"hello",auth}→{type:"welcome",clientId}`; `{id,tool,params,auth}↔{id,status,auth,...}` | — | `src/offscreen/bridge-link.js:21-27,82-153` |
| content-script `postMessage` collect | top frame ↔ cross-origin child frames | `{type:"__perscope_dom_collect__", collectId, frameToken}` → `{type:"__perscope_dom_response__", collectId, frameToken, result}` | 900 ms timeout; non-responses counted, never silently omitted | `src/content/dom-capture-entry.js:32-34,100-151,155-181` |

---

## 4. `manifest.json` — current state

> NOTE: this is `extension/v7 beta/manifest.json` (49 lines). Top-level
> `extension/manifest.json` is a 1-line ownership stub, not a manifest.

- **Permissions:** `["offscreen", "storage", "activeTab", "scripting"]`
  (`manifest.json:6`). No `"tabs"` permission — this is why offscreen's bridge
  `capture_tab` rejects explicit `tabId` targeting
  (`src/offscreen/offscreen.js:92-96`) and only active-tab capture works.
- **`content_scripts`:** registered — one entry (`manifest.json:8-15`):
  `matches: ["<all_urls>"]`, `js: ["dom-capture-entry.js"]`,
  `all_frames: true`, `run_at: "document_idle"`. **A DOM-capture content script
  IS registered** (README §7.3's "currently absent" status is stale — see §8).
- **Other:** `host_permissions: ["<all_urls>"]`; `background.service_worker:
  "background.js", type: "module"`; `action.default_popup: "popup.html"`;
  `options_ui.page: "dashboard.html"`; `web_accessible_resources` covers
  `models/*`, `ort/*`, `assets/*`, `dashboard.html` for `<all_urls>`; MV3 CSP
  `script-src 'self' 'wasm-unsafe-eval'`; `dist/manifest.json` is byte-identical
  in these fields (verified by read).

---

## 5. `build.mjs` — actual bundling behavior

> Only `extension/v7 beta/build.mjs` (152 lines) exists. There is no root
> `build.mjs`.

- **One shared bundling loop** (`build.mjs:29-55`) handles all five entries with
  **identical esbuild options**: `bundle:true, format:"esm",
  platform:"browser", target:"es2022"`, `mainFields:["module","browser","main"]`,
  `conditions:["browser","module","import"]`,
  `external:["fs","crypto","path","os","module","readline"]`,
  `loader:{".wasm":"file"}`, `define:{"process.env.NODE_ENV":'"production"'}`.
- Entries (`build.mjs:14-27`): `src/popup/popup.js→popup.js`,
  `src/background/service-worker.js→background.js`,
  `src/offscreen/offscreen.js→offscreen.js`, `src/app/dashboard.js→dashboard.js`,
  **`src/content/dom-capture-entry.js→dom-capture-entry.js`**.
- **Prior-task assumption — CONFIRMED, with a footnote:** the content script
  bundles **the same way `offscreen.js` does** (same loop, same flags). The file
  itself says so (`build.mjs:20-25`). The only content-script-specific accommodation
  is that `"readline"` is in the shared `external` list, because
  `piidetector.js`'s Node CLI branch (`require("readline")` under
  `require.main === module`) is dead in the bundle. That branch never fires in
  the content script; it is also present (dead) in the bundled copy.
- **Footnote (asymmetry):** the post-build CDN→`chrome.runtime.getURL("ort/")`
  patch loop (`build.mjs:138-150`) rewrites only
  `["offscreen.js","popup.js","dashboard.js"]` — `background.js` and
  `dom-capture-entry.js` are bundled but never patched. Unclear from code whether
  either bundle contains a CDN string that would need the patch.
- Model packaging: slim default bundles only `paddleocr` + `blazeface`
  (`build.mjs:106`); `INCLUDE_BIG_MODELS=1` adds `ettin-68m-nemotron-pii-onnx`
  and the single-path FastVLM copy at `models/onnx-community/FastVLM-0.5B-ONNX`
  (`:107-135`).

---

## 6. Model / session lifecycle

Source: `extension/v7 beta/src/pipeline/v7-extension.js` (902 lines),
`src/pipeline/face.js`, `src/offscreen/offscreen.js`.

| Model | Loaded where | Source path / fallback | EP | Session reuse |
|---|---|---|---|---|
| PaddleOCR PP-OCRv6-small (per-box, conf ≥ 0.5) | offscreen only, `_ocrServiceCache` module singleton (`v7-extension.js:84,154-199`) | packaged `models/paddleocr/...small...` via HEAD-check, else library default | WASM (`session:{executionProviders:["wasm"]}`, `:193`) | reused across jobs until offscreen document unloads |
| Ettin-68M Nemotron PII | offscreen only, `_nerCache={tokenizer, model, id2label, maxTokens}` (`v7-extension.js:85,255-302`) | `resolveNERModelPath`: local `models/ettin-68m-nemotron-pii-onnx` if `config.json` fetches OK, else HF `rulesentry-io/ettin-68m-nemotron-pii-onnx` (`:241-250`) | WebGPU pinned; single-thread WASM fallback (`intra/interOp:1`) because int64 encoder inputs crash threaded WASM (`:260-265`) | reused across jobs; also idle-pre-warmed |
| FastVLM-0.5B (fp16 embed / q4f16 vision+decoder) | offscreen only, `_fastvlmCache` (`v7-extension.js:86`) | local `models/onnx-community/FastVLM-0.5B-ONNX` via `localModelPath` probing, else remote `from_pretrained` | WebGPU pinned, WASM CPU retry | reused; pre-warmed |
| BlazeFace (`blaze.onnx`, 128×128 NCHW, NMS IoU 0.3 / max 25 / conf 0.6) | offscreen via `runFaceDetection` (`face.js:64`, `v7-extension.js:650`) | packaged model URL | WASM default, WebGPU optional | per-call helper (see `face.js`) |

- **Pre-warm:** `offscreen.js:36-48` schedules `_prewarmModels()` on
  `requestIdleCallback` (8 s timeout); `_prewarmModels`
  (`v7-extension.js:95-114`) resolves the device, configures ORT, then loads NER
  + FastVLM in background. OCR is **not** pre-warmed (loads on first job).
- **Sharing:** sessions are module-level singletons in the offscreen document —
  shared across popup/dashboard/bridge jobs in that context, re-created only if
  the offscreen document reloads. No cross-context sharing (background/popup/
  content scripts hold no models).
- **Text-only reuse verdict — needs refactoring first:** the offscreen Ettin
  session is reached only through `runNER(ner, ocr)` (`v7-extension.js:307`),
  which takes the **OCR result object** (`buildOCRGlobalSpans(ocr)`, `:309`)
  and emits OCR-index-mapped findings. There is **no text-in/text-out NER entry
  point**; a DOM-text caller would have to either synthesize a fake OCR object
  or refactor `runNER`/span-mapping to accept raw text. The tokenizer+model in
  `_nerCache` are theoretically reusable, but the call path is coupled to the
  OCR-input shape today.

---

## 7. `piidetector.js` integration — wired vs. commented-TODO

Root `piidetector.js` (1142 lines, `"use strict"`, CommonJS) exports
`{PATTERNS, REPLACEMENTS, luhn, ibanValid, isValidIPv4, detectPII, redactPII,
processPII, extractDOMText, extractFormValues}` (`piidetector.js:1066-1081`).

- **`processPII` (Tier0 one-shot) is NOT called anywhere in the live extension.**
  Grep over the repo finds `processPII` only at its definition
  (`piidetector.js:800`), its export (`:1077`), its own CLI self-call (`:1119`),
  and the dead bundled copy inside `dist/dom-capture-entry.js`. No file under
  `src/` references it. The DOM path deliberately calls `detectPII` +
  `redactPII` separately per segment
  (`src/pipeline/dom-capture.js:416-418`), never the one-shot.
- **Live call sites (the only two):** `detectPII(text)` and
  `redactPII(detection.text, detections)` inside `runTier0OnSegments`
  (`src/pipeline/dom-capture.js:416-418`), fed per-segment. Nothing in the image
  pipeline (`v7-extension.js`, `heuristics.js`, `safety.js`) touches
  `piidetector.js`.
- **No Ettin/Tier1 call site of any kind:** the strings `RUN_ETTIN_NER`,
  `Tier1`, `Ettin`, `stub`, `TODO`, `REQUIRED`, `FIXME` appear **zero times** in
  `piidetector.js` (verified by grep). There is no Tier1 stub — not even a
  commented one.
- **Discrepancy — the premise about "sections 9–10 `[REQUIRED, TODO]` comments"
  does not match disk:** the file's `IMPORTANT SECURITY DESIGN NOTES` block
  contains **sections 1–8 only** (`piidetector.js:38-193`: regex-is-not-enough,
  context-matters, do-not-blindly-redact-the-DOM, redact-before-logging,
  offsets, overlaps, security-vs-usability, future-hardening). There are no
  sections 9–10 and no `[REQUIRED, TODO]` markers to cross-check — so there is
  nothing that "silently got implemented": `extractDOMText` / `extractFormValues`
  remain the original naive stubs, and both carry explicit `NOTE (DOM snapshot
  pipeline contract)` comments (`piidetector.js:890-904, 956-962`) stating they
  are **superseded** by `src/pipeline/dom-capture.js` for the extension pipeline
  but kept exported for other callers/tests. `shouldIgnoreElement` likewise
  remains the original (script/style/noscript/template/svg/canvas +
  hidden/aria-hidden) while the live walker uses its own `isIgnoredElement` in
  `dom-capture.js:68-82`.

---

## 8. DOM-capture status

Implemented in: `src/pipeline/dom-capture.js` (458 lines),
`src/pipeline/dom-heuristics.js` (295 lines), `src/content/dom-capture-entry.js`
(225 lines); wired to UI via `REQUEST_DOM_CAPTURE`/`CAPTURE_DOM_TEXT`
(background + popup); tested by `tests/dom-capture.test.mjs` (11 tests, all
passing — see §10).

Checked against the task brief's acceptance criteria:

| Criterion | Status | Evidence |
|---|---|---|
| Segment shape `{id, kind, tag, attr?, text, blockRole, forceRedact, structuralHint?, domPath}` | **Met** | Built in `dom-capture.js:256-268` (form), `:286-299` (attribute), `:313-322` (text); contract also restated in `piidetector.js:894-896` |
| Text / attribute / form-value coverage | **Met** | `ATTRIBUTE_SEGMENT_NAMES=["aria-label","alt","title","placeholder"]` (`dom-capture.js:38`); `FORM_VALUE_TAGS={input,textarea,select}` (`:40`); selectmulti-select joined (`, `) at `:147-162` |
| Shadow DOM handling (open traversed, closed counted) | **Met** | `walkRoot` recurses `shadowRoot` when `mode==="open"`, else `skipped.shadowRootsClosed+=1` (`dom-capture.js:209-222`); test "shadow DOM" passes |
| Iframe cross-origin skip-counting (never silently omitted) | **Met** | Same-origin recursed via `contentDocument` (`:229-245`); cross-origin collected via `all_frames` postMessage channel with 900 ms timeout; unreachable counted in `skipped.iframesCrossOriginUnreachable` (`dom-capture-entry.js:130-150`); test "iframes" passes |
| Password/hidden force-redact (skip `detectPII`) | **Met** | `classifySensitiveField`: `type=password`/`type=hidden`/secret autocomplete → `forceRedact` (`dom-heuristics.js:73-98`); forced segments go straight to `<PASSWORD>`/`<CARD_NUMBER>`/`<FORM_SECRET>` placeholders with `confidence:1.0` (`dom-capture.js:393-409`, `dom-heuristics.js:104-111`); tests pass |
| `source:"dom"` tagging + confidence passthrough | **Met** | Findings carry `source:"dom"`, Tier0 `confidence` untouched, context as sibling `structuralHint` (`dom-capture.js:420-429`); "confidence passthrough" test passes |
| Structural hints (label / autocomplete / field name / table header) | **Met** | `resolveStructuralHint` covers `<label for>`, wrapped labels, `aria-labelledby`, autocomplete+name/id, `<td>` headers (`dom-heuristics.js:131-217`); label + table-header tests pass |
| Block-aware rebuild (not one joined string) | **Met** | `reconstructDocument` with paragraph/heading/list/table roles (`dom-heuristics.js:259-295`); test passes |
| Raw-text hygiene (redact before logging, domPath local-only) | **Met** | `segment.text`/`domPath` zeroed after rebuild (`dom-capture.js:59-62, 445-448`); findings carry no raw values/offsets/paths (`:383-388, 420-429`); popup renders only redacted document + type/source metadata (`popup.js:386-441`) |
| Live-DOM non-mutation | **Met** | Snapshot-only by construction; no write call exists in the three modules |
| Determinism | **Met** | "determinism" test passes |
| Bridge `read_page` serving DOM capture | **Not started** | `offscreen.js:76-127` still answers `read_page` (and `list_interactive_elements`, `click`, `type`, `select_option`, `submit`, `scroll`) with `dom-not-implemented-in-beta` — stale relative to the now-existing content script, but factually the bridge path is unwired |
| `isDestructive` live wiring | **Not started** | Pure, unit-tested module (`src/shared/is-destructive.js`); header comment states it is "NOT wired to any live action" in Beta (`is-destructive.js:1-16`) |

**Discrepancy:** README §7.3 header says "**Status: not started.** Depends on
`content.js` existing (currently absent…)". On disk, the DOM snapshot pipeline
exists, is registered in the manifest, is reachable from the popup, and passes
11/11 tests. The README section is stale, not the code.

---

## 9. Outstanding TODOs across the whole repo (`src/` + `piidetector.js`)

Grep for `TODO|FIXME|REQUIRED|XXX|HACK|STUB` (case-sensitive, code + comments,
excluding `dist/` build output and `node_modules`):

- **Zero hits in `extension/v7 beta/src/`** (all `.js/.mjs/.html/.json`).
- **Zero hits in root `piidetector.js`.**
- The closest things to TODOs are plain-English deferral comments (no markers):
  - `src/offscreen/offscreen.js:78` — DOM tools "need content.js, which is
    deferred to Final by design — they answer with an explicit error, never
    silence and never fake data."
  - `src/offscreen/offscreen.js:92-93` — "Beta scope: active-tab capture only.
    Targeting an arbitrary tabId needs the `tabs` permission, deferred to Final
    with scripting."
  - `src/offscreen/offscreen.js:123` — the `dom-not-implemented-in-beta` reason
    string itself.
  - `src/shared/is-destructive.js:1-16` — "BETA status… NOT wired to any live
    action… Final wires it in front of every click/type/select_option/submit."
  - `src/pipeline/v7-extension.js:66` — "deliberately NOT deferred…" (design
    note about `env.allowLocalModels`, not a TODO).
- (`dist/*.js` contains ~20 upstream-library `TODO` comments from
  `@huggingface/transformers` / `onnxruntime-web` bundles — third-party noise,
  not repo action items — plus the bundled copy of the
  `dom-not-implemented-in-beta` string at `dist/offscreen.js:48869`.)

Separately, the README's own §6 admits one live inconsistency, **confirmed on
disk**: `tests/run-checks.mjs:26` requires
`models/FastVLM-0.5B-ONNX/config.json`, but the real full-offline path is
`models/onnx-community/FastVLM-0.5B-ONNX/...` — which is exactly why `npm run
check` fails (see §10), even though `dist/` contains a complete FastVLM copy
under the `onnx-community/` path.

---

## 10. Test / check status (actually run, 2026-09-25)

| Command | Result |
|---|---|
| `npm run check` (`node tests/run-checks.mjs`) in `extension/v7 beta` | **FAIL** — all 13 prior artifacts found (incl. `dom-capture-entry.js`, ORT wasm, BlazeFace), then `FAIL: Missing required build artifact: models/FastVLM-0.5B-ONNX/config.json`. This is the known-stale legacy path from README §6: `dist/` holds FastVLM at `models/onnx-community/FastVLM-0.5B-ONNX/` (config + weights present) plus Ettin and 3× PaddleOCR sizes, but the check asserts the old top-level path. Fix is a one-line check update, not a build problem. |
| `node --test tests/dom-capture.test.mjs` in `extension/v7 beta` | **PASS 11/11** (email+label+password+aria findings, label association, table headers, shadow DOM, iframes, walker rejection, determinism, force-classify, autocomplete map, rebuild, confidence passthrough) |
| `node --test tests/pipeline.test.mjs` in `extension/v7 beta` | **PASS 9/9** (GPU tiers, heuristics extraction, fusion, JSON extraction, NMS, canvas clamp, value-bbox geometry) |
| `node --test tests/is-destructive.test.mjs` in `extension/v7 beta` | **PASS 5/5** (destructive keywords, safe navigation, submit fail-closed, input-type gating, unknown-tool fail-closed) |
| `node tests/qwen_regression.test.mjs` at repo root (`npm test`) | **PASS** — all 16 assertions ("All regression tests passed."), pure-logic harness over `qwen_redaction_pure.mjs`, no models needed |
| `npm run check` at repo root | **N/A — script does not exist.** Root `package.json` scripts are `test, test:verbose, perception, redact, redact:pure-test, pii`. Unclear from code whether the brief's "`npm run check`" meant root or `extension/v7 beta`; only the latter has a `check` script. |

---

## Appendix — largest known doc-vs-disk gaps (planning aid, not review)

1. Root `extension/*` vs `extension/v7 beta/*`: two parallel extension trees;
   only the latter is implemented. Pick one canonical location before wiring
   anything new.
2. README §7 ("not started" bridge/DOM/playground) is partially stale: DOM
   snapshot capture is built, registered, UI-wired, and tested; bridge
   `read_page` and `isDestructive` wiring are genuinely still pending.
3. Prior-task premise "content script bundles the way `offscreen.js` currently
   does": **confirmed true** (§5) — but verify against `build.mjs:29-55`, not
   memory, if the bundling ever changes.
4. Prior-task premise "`piidetector.js` sections 9–10 `[REQUIRED, TODO]`": **no
   such sections exist on disk** (§7) — do not plan Tier1 work around comments
   that aren't there; the Tier1/Ettin gap is real but undocumented in that file.
5. `npm run check` is red only because of the stale FastVLM assertion path, not
   because the build is broken — and `dist/` on disk is a full-offline build
   (Ettin + FastVLM + 3× PaddleOCR), not the slim build `build.mjs` produces by
   default.
