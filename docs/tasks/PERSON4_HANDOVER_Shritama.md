# Handover — Person 4 (Shritama): Extension UI Rebuild on Beta + Automation

Hey Shritama — `git pull` on `main` first. This one file is your complete list. It supersedes the old `capture-review` pinned item and the tiered-pipeline wording in `04-extension-automation.md`.

Scope: `extension/` only. Pipeline/models are Person 2+3 — you do NOT touch them. Server/bridge/playground is Person 5. Background validator pairs with Person 1.

## 0. Beta analysis — what exists, what it was for

`extension/v7 beta/` is a **model-test prototype**: upload/capture an image → run BlazeFace+PaddleOCR+Ettin+FastVLM fusion → show redacted image + caption + evidence JSON. Its UI proves the pipeline works; it is NOT the intended product UI (no Capture Review states, no Send-to-Chat, no logs, no validator, no WS client). Strategy: **build on top of the beta** — keep its pipeline wiring, replace its model-centric UI with Human Mode UI.

File-by-file verdict:

| Beta file | Verdict | Detail |
|---|---|---|
| `manifest.json` | KEEP + EXTEND | Has MV3, `offscreen/storage/activeTab`, HF hosts, CSP `wasm-unsafe-eval`, popup, options. MISSING: `tabs`, `scripting`, `<all_urls>`, `side_panel`, `minimum_chrome_version:"116"`, content-scripts, full icons. You add these (§Task 1). |
| `src/background/service-worker.js` (70 lines) | KEEP AS BASE, EXTEND | Only `ENSURE_OFFSCREEN` + `CAPTURE_VISIBLE_TAB`. No WS client, no keepalive, no routing, no validator. You add all three (Tasks 3–4). Do not break existing two handlers. |
| `src/offscreen/*` + `src/pipeline/*` | DO NOT TOUCH | Owned by Person 2+3. Interface you rely on: `ENSURE_OFFSCREEN` → `RUN_PIPELINE {jobId, imageBytes: Array<number>, options}` → `{status:"SUCCESS", outputBase64, evidence, totalTimeMs}` + `PIPELINE_PROGRESS {stage,status}` pushes. Bytes go as `Array<number>`, image returns as base64. Prewarm is idle-scheduled. Never modify fusion/geometry/safety code. |
| `src/popup/popup.html+js` (231+391 lines) | REUSE WIRING, REBUILD UI | KEEP: drop-zone/upload/paste/`btnCaptureTab` entry, `handleImageFile` → `ENSURE_OFFSCREEN` → `RUN_PIPELINE` flow, `PIPELINE_PROGRESS` stepper plumbing, Redacted/Original/PII-Overlay views + `renderBBoxOverlay`, caption/stats/export handlers, base64 decode. REPLACE: `v7 GPU` badge, `FastVLM 0.5B` titles, user-facing device-tier selector + FastVLM/face toggles (move to collapsible Advanced or drop), inference-ms hero stat. ADD: Human Mode flow (Task 2). |
| `src/app/dashboard.*` (175-line html) | KEEP PATTERN, ADD LOGS | KEEP: dual viewer (original+overlay / redacted), inspector tabs (Caption/Evidence/Prompts). ADD: Privacy Log + Security Log + Clear All + redacted-only storage (Task 6). Current dashboard has zero logs — that is the gap. |
| `extension/{background,content,dashboard,popup,sidepanel}/*` (root stubs) | BUILD HERE | All are `// Not implemented here` placeholders. Promote beta `src/*` into these real paths (Task 1). No `chat-adapters/` exists — you create it (Task 5). |

## 1. Promote beta + manifest upgrade (do first)

1. Copy beta `src/popup/*` → `extension/popup/`, `src/app/*` → `extension/dashboard/`, `src/background/service-worker.js` → `extension/background/background.js`, keep `src/offscreen+pipeline` where they are (or mirror path — decide once, update all `chrome.runtime.getURL` refs + build `v7 beta/build.mjs` output `dist/`).
2. `extension/manifest.json`: add `permissions: ["tabs","scripting","offscreen","storage"]`, `host_permissions: ["<all_urls>"]`, `minimum_chrome_version: "116"`, `side_panel: {default_path: "sidepanel/index.html"}`, content-script entry for `content/content.js`, full icons. Keep beta CSP + `web_accessible_resources` for `ort/*, models/*`.
3. Firefox decision (closes your half of pinned `face-firefox-decision`; face half already done via BlazeFace): either add `browser_specific_settings.gecko` + test, or write one paragraph in `docs/limitations.md` + README stating Chrome-first with reason. No silent claim.
Verify: `Load unpacked → dist/` still runs pipeline; popup opens; no console CSP errors.

## 2. Popup rebuild — Human Mode on beta wiring (your main UI task)

Keep `handleImageFile`, `RUN_PIPELINE`, progress listener, viewer, overlay, export. Change the chrome around them:
1. Header: keep brand + dashboard opener; drop `v7 GPU` badge (or → `On-device ✓`). Keep `Privacy protected ✓` always visible + footer `Everything stays on this device.`
2. Input: tab selector (defaults to current tab) + **Capture** button (rename from Analyze). Keep upload/drop/paste as secondary entry.
3. Progress: keep 5-step plumbing but relabel to user words `page captured → text extracted → sensitive detected → sanitizing`. Stages map: IMAGE/OCR → captured/extracted, NER+HEURISTICS+FASTVLM → detected, REDACT → sanitizing.
4. **Capture Review (required gate before any send)** — new section reusing viewer + a new Context view (sanitized JSON with `[PERSON]/[EMAIL]/[REDACTED:TYPE]` placeholders):
   - Visual view: redacted image + bbox overlay toggle (reuse `renderBBoxOverlay`).
   - Context view: structured sanitized JSON (from `evidence.final_findings`, never raw values).
   - States: **Clean** (`No sensitive info detected` — never `0 redacted`), **Ambiguous/low-confidence** (fail-closed, must review), **Blocked** (cannot sanitize → no Send buttons enabled). Stats: count + type redacted.
5. **Send vs Send & Submit + destination picker**: **Send** injects into chat input only (default); **Send & Submit** injects + submits (explicit opt-in). Destination: auto-detect open ChatGPT/Claude/Gemini tabs + manual pick. Wrap payload in explanatory header so target AI understands placeholders. Executes via `content.js` (Task 5).
6. Move device-tier/redaction-style/FastVLM/face toggles into collapsible Advanced (or drop FastVLM/face toggles — never gate privacy on them).
Verify: capture → review → states correct → Send disabled when Blocked → Send fills chat input, Submit actually submits only on opt-in.

## 3. Background WS client + routing (pair Person 1)

In `extension/background/background.js`, keep existing handlers, add:
1. WS client to same URL as playground/bridge/server, same `{id,tool,params}` schema (`docs/tool-schema.md` 7 tools). Multiplexes Playground/Bridge/Reasoning Server with zero per-caller branching.
2. 20s `{type:"ping"}` → expect `{type:"pong"}` keepalive (SW dies idle otherwise, Chrome 116+).
3. Route `list_interactive_elements` → offscreen pipeline → sanitized response; reflect real stages in popup loading UI. `read_page`/`click`/`type`/`submit`/`select_option`/`scroll` route to `content.js` after validator.
Verify against all three callers (playground mock, bridge, server stub) — same validator path each time.

## 4. Validator `isDestructive()` + confirm flow (pair Person 1)

Same logic gates every caller, including prompt-injection text (it judges what the action *would do*, not where text came from):
- `isDestructive({tool,params,element})` → destructive ? `{status:"blocked", reason, pending_id}` (never `error`) + `pendingActions.set(pending_id, {…, 60s timeout})` : execute via `content.js` → `{status:"ok"}`.
- Sidepanel Approve/Deny → `{type:"action_update", pending_id, status:"ok"|"denied"|"timeout"}` pushes back to caller.
Verify: staged white-on-white injection targeting destructive action is blocked identically whether it came from server, bridge, or playground.

## 5. `content.js` + chat-adapters + injection (new build)

Create `extension/content/chat-adapters/` with 2–3 per-site adapters (ChatGPT/Claude/Gemini input-box selectors) + clipboard fallback for unknown destinations. `content.js` is the ONLY live-DOM access: captures state, executes validated actions via `chrome.scripting`/`tabs.sendMessage`. No second DOM path.
Verify: Send → text appears in chat box unsubmitted; Send & Submit → submitted; unsupported site → clipboard fallback + notice.

## 6. Sidepanel + Dashboard logs (new build)

- `extension/sidepanel/`: live view + Approve/Deny prompt (blocked action shows what/why, 60s countdown).
- `extension/dashboard/`: add **Privacy Log** (per-capture: source, count/type, destination, redacted-only storage, Clear All) + **Security Log** (blocked + confirm outcomes). Entries read as **captures**, never raw events/values.
Verify: each capture appends one Privacy Log row; each blocked action appends one Security Log row; Clear All wipes both; reload shows no raw PII persisted.

## 7. Prompt-injection demo path + disclosures

Stage a page with hidden white-on-white instruction targeting a destructive action → must be blocked by same validator; narrate it on stage. Disclose `tabs`+`scripting` permission increase in pitch + README (not silent). Update `docs/limitations.md` (WASM single-thread, FastVLM-0.5B blandness, heuristics over-redact edge) — state proactively.

## 8. What NOT to do anymore (stop list)

1. Do NOT modify `v7 beta/src/pipeline/*` or offscreen ML (fusion, geometry, safety, model choice) — Person 2+3 own it. Your old task-3 wording (`3 extractors → tiered → plan`) is superseded; the pipeline is parallel-fusion behind `RUN_PIPELINE`.
2. Do NOT polish model-test chrome (FastVLM/face toggles as primary UI, `v7 GPU` badge, inference-ms as hero, caption card titled `FastVLM 0.5B Image Caption`).
3. Do NOT build server/bridge/playground or pick the server model (Person 5 + Person 1).
4. Do NOT add model downloads, new npm deps, or second DOM/injection paths.
5. Old pinned `capture-review` (must-do, due 09-08) is superseded by Tasks 2+5+6 above — deleted from pinned list with this handover.

## Acceptance (run before review)

1. Fresh `Load unpacked` → Capture tab → Review (Visual + Context) → states correct → Send fills chat, Submit submits only on opt-in.
2. WS connected → all 7 tools route; kill idle 30s → keepalive holds; destructive → sidepanel Approve/Deny → `action_update` roundtrip.
3. Dashboard shows Privacy + Security logs, Clear All works, no raw values stored.
4. Injection demo page blocked regardless of caller. Permissions + Firefox decision documented.
5. Ping Person 1 (validator/keepalive), Person 2+3 (evidence shape), Person 5 (same WS schema).
