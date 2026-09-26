# Handover — Person 5 (Banashree): Playground Chat Rework — ALL Tasks + Guide

> **Status 2026-09-16: T0–T8 slice done per `LIST.md`; this file's push-flow contract (line 5) is dead** — blocking call + `ref` dialect rule in `docs/tool-schema.md`. Remaining live item here is the chat rework = T6 (deferred, D6 open). `perscopee.* → playground.*` rename IS done on disk (the "Fix 1 DONE" claim is now true).

Hey Banashree — `git pull` on `main` first. This one file is your complete work list. Nothing outside `playground/` unless stated.

Contract (never violate): `docs/tool-schema.md` — `{id, tool, params} → {id, status: ok|blocked|error, result|reason|pending_id}` + async `{type:"action_update", pending_id, status: ok|denied|timeout}` + `{type:"ping"}↔{type:"pong"}`.
Visual to copy: root `claude_process_chat_mock.html:96-138,141-246` (chat + thinkingCard + 5-node trace + composer).
Background: `docs/tasks/05-server-bridge-playground.md` §A–E. If §D conflicts with this file, this file wins.
Due: P0 / 2026-09-18. No new deps without Person 1.

## 0. Setup (15 min, do first)

1. `cd playground && npm install`
2. Terminal 1: `node js/server/websocket-server.js` → expect `WebSocket server running on ws://localhost:8080`
3. Terminal 2: `npx serve ui -l 3000` → open `http://localhost:3000/playground.html`
4. Open DevTools console. After Task 9 your WS Start button must turn green + log `Connected to WebSocket server`. Red when server stopped = correct.
5. Baseline gates (must be 0 at end):
   ```
   rg -i "travelease|mock-destination|mock-search|Search Hotels|Mumbai|2 Adults" playground/
   rg -i "pii-count|sanitized-count|audit-status|Email.*Phone.*Card" playground/ui/
   rg -i "perscopee" playground/
   ```
Already done — don't redo: Fix 1 — `playground/playground/` flattened to `playground/` (`js/{client,demo,server} + ui/playground.html,css,js`), `perscopee.*` renamed.

Work order: 1 → 2 → 8 → 9 → 3 → 4 → 5 → 6 → 7 → 10 → acceptance.

---

# PART A — Previous tasks (still required, re-targeted at chat UI)

## Task 1. `playground-ws-single` — one WS client, no auto-run

Why: `ui/playground.js:129-348` is the real browser client. `js/client/websocket-client.js:34-41` auto-runs `runDemoSequence()` on `socket.onopen`, fighting manual Start/chat-send and opening a second socket.
Files: `playground/ui/playground.js`, `playground/js/client/websocket-client.js`. Never import the Node client from HTML.
Do:
1. Keep `ui/playground.js` as the ONLY browser client.
2. Open `js/client/websocket-client.js`, delete the `socket.onopen = async () => { ... await runDemoSequence() }` block. Convert to headless smoke-test: `connect → send read_page → console.log → process.exit(0)`. Usage: `node js/client/websocket-client.js`.
3. Chat-send (Task 8) becomes the only trigger. No `setTimeout` auto-demo.
Verify: serve `ui/`, open console — on WS open nothing runs. Chat send runs once. Network tab shows 1 socket.

## Task 2. `playground-schema-parity` — match `docs/tool-schema.md` exactly

Copy these shapes verbatim:
- `type` in `{element_id: string, value: string}` (NOT `text`)
- `select_option` in `{element_id: string, value: string}` (NOT `option`)
- `submit` in `{element_id: string}` (NOT `{}`)
- `scroll` in `{direction: "up"|"down", amount: "page"|integer}` → out `{scroll_y: number}` (NOT echo)
- `click` ok out `{id, status:"ok"}` (+ optional bare `result:{}`) — strip `{clicked:true, label}` extras
Files: `ui/playground.js` (`type` ~1057-1064, `select_option` ~1099-1105, `submit` ~1141, `scroll` ~1173-1191), `js/server/websocket-server.js` (150-174, 205-256, 330-346), `js/client/websocket-client.js` (226-256).
Do: find-replace `text:` → `value:` in type path; `option:` → `value:` in select path; `sendRequest("submit")` → `sendRequest("submit",{element_id:"el_5"})`; server scroll returns `{scroll_y: currentY ± amount}`; server click returns bare ok. Optional but good: unknown/old params → `{status:"error", reason:"invalid_params"}`.
Verify: console `sendRequest("type",{element_id:"el_1",value:"Mumbai"})` → ok; old `{text}` → error.

## Task 3. `playground-validator-flow` — PAIR WITH PERSON 1 (main SIH story)

Why now fake: server `websocket-server.js:274-291` only checks `allowedElements` existence; `runDestructiveScenario/runInjectionScenario` (`ui/playground.js:1225-1432`) never hit WS — just `delay + BLOCKED` text. No `pending_id`, no decision, no timeout.
Spec: `tool-schema.md` click-blocked shape + confirm-flow + `security-model.md §5`.
Do:
1. Server — add `function isDestructive({tool, params, element})`. Stub: destructive if `tool==="click" && (element.label.includes("Delete") || params.element_id==="el_danger")`. Add mock `el_8: {label:"Delete Account", type:"button"}` to elements. If destructive:
   ```js
   const pending_id = `pend_${Date.now()}`;
   pendingActions.set(pending_id, {tool, params, timeout: setTimeout(()=>expire(pending_id), 60000)});
   socket.send(JSON.stringify({id: request.id, status:"blocked", reason:"destructive_action_unconfirmed", pending_id}));
   return;
   ```
2. Client `sendRequest` (`ui/playground.js:290-343`) — currently filters `response.id===request.id` and drops pushes. Add parallel listener for `response.type==="action_update"` with matching `pending_id`; resolve/update the turn's Acting node. Render Approve/Deny buttons inline in the Acting node (Task 8) when `blocked`; Approve → server sends `{type:"action_update",pending_id,status:"ok"}`, Deny → `denied`, 60s → `timeout`.
3. Destructive/injection flows must REALLY call `await sendRequest("click",{element_id:"el_8"})` and expect `blocked` — as preset chat prompts, not separate runners.
4. Add `stale_element`: unknown `element_id` → `{status:"error", reason:"stale_element"}` + re-resolve via fresh `list_interactive_elements`.
Verify: chat "delete my account" → `blocked + pend_xxx` in Tool Response → Approve → `action_update ok` in Event Log.

## Task 4. `playground-keepalive-errors`

Why: SW dies without keepalive; demo stalls silently.
Do:
1. Both sides: `setInterval(()=>socket.readyState===1 && socket.send(JSON.stringify({type:"ping"})),20000)` + `if(msg.type==="ping") send({type:"pong"})`.
2. `sendRequest`: 5s `setTimeout → reject("timeout")`, `socket.onerror` → `addUIEvent("WebSocket error: "+reason,"error","Playground")`.
3. Every tool response checked: `if(res.status!=="ok"){addUIEvent(tool+" "+res.reason,"error","Server"); render turn error; return;}` — currently only once at `:832`.
4. Unify `js/demo/demo-state.js:25-31` to `addEvent(message, status="info", source="Playground")`; fix `js/client` callers dropping 3rd arg.
Verify: stop server → red Disconnected + warning; send `{tool:"unknown"}` → `error: unknown_tool` in red, not success.

## Task 5. `playground-sanitized-truth` — PAIR WITH PERSON 2+3

Why: `updatePrivacySummary():727-736` hardcodes `3/3/PASS` + Email/Phone/Card — unrelated to any real page; server `66-134` leaks raw `Mumbai, 12/06/2025` in clear.
Do:
1. Derive counts from `demoState.lastResponse.result.findings.length` or show `— (MOCK)`. Delete Email/Phone/Card list.
2. Server values → `[REDACTED:TYPE]` per `tool-schema.md:62-85`, plus adapter hook:
   ```js
   // TODO(Person 2+3): replace mockElements with real sanitized JSON
   // const sanitized = await getRealPipelineResult()
   // {elements:[{id,type,label,value:"[REDACTED:EMAIL]",bbox}],findings,confidence}
   ```
3. Don't expand mocks. `View Raw JSON` shows what agent receives (sanitized), never raw PII.
Verify: Screen State values redacted or badged MOCK.

## Task 6. `playground-ui-deadweight` — delete dead code

- Pause button + `let paused` (`playground.js:25,805,1727-1758`) — checked once, never mid-chain → delete button + flag + handler.
- Dead `Execute Action` (`:2309-2324`, logs only) → wire to `sendRequest(nextTool,nextParams)` or delete button + handler.
- Dup `scenario-select` + `scenario-cards` (both auto-start) → keep one; other becomes preset prompt setter only.
- Dup `theme-toggle` + `settings-theme-toggle` + `body.light-theme` overrides (`playground.css:1628-1678`) → keep one toggle.
- Latency hack `showLatency()` creating `#latency-value` at runtime (`:387-433`) → static `<span id="latency-value">` in HTML.
- `updateToolUI` forcing every used tool to `read` → use `gated` for click/type/submit/select_option, reset on Reset.
- `agent-input-panel display:none` (CSS:1473) vs JS `style.display="block"` → use `.hidden` class like scenarios/settings.
Verify: Reset clears badges/latency/validator; no dead button does nothing.

## Task 7. `playground-packaging` — runnable for anyone

`playground/package.json`: `main: js/server/websocket-server.js`; scripts `start: node js/server/websocket-server.js`, `serve: npx serve ui -l 3000`, `dev` both. Add `serve` (+`concurrently` if used) to devDeps. Decide `package-lock.json`: gitignore or document. Create `playground/README.md`: `npm install` / Terminal 1 `npm start` (ws URL) / Terminal 2 `npm run serve` (http URL) + extension note (same schema, second client).
Verify: fresh clone both commands work, chat connects green.

---

# PART B — New redesign (supersedes polishing mocks — DELETE, don't fix)

## Task 8. Delete Live Browser + add Chat (copy mock)

Delete `<section id="live-view">` (`.browser-window`, `.mock-browser-content`, `#mock-destination`, `#mock-guests`, `#mock-search-button`, TravelEase nav/hero/search) + its CSS + `runNormalDemo` hotel chain/`el_1..el_7`/`Click on "Search Hotels"` + `scenarios.normal` hotel copy. Layout after: sidebar | chat | inspector. No replacement fake site.
Add `<section id="chat-panel" class="panel chat-panel">`: `#chatWrap > #chat` + `#thinkingCard` + `#process > .tree > 5 nodes` (Perception, Redacting, Reasoning, Acting upon, Done) + composer (`#chat-input`, `#chat-send`, `#chat-status`). Enter=send, Shift+Enter=newline, auto-resize (mock `:231-238`). `submitChat()`: bubble → `Processing…` → per-turn `appendChild(thinkingCard/process)` (mock `:177-178`) → WS sequence, each result marking its node done. Blocked → Approve/Deny inline in Acting node. Chat-send is the only trigger.
Verify: "hello" → bubble + thinking → trace in same turn; second send = clean turn.

## Task 9. Privacy panel → chip + WS Start button + in-chat progress

- Delete `<section id="privacy-summary">`; add `🔒 sanitized-only` chip in chat header + `<details id="privacy-details">` in Screen State (real `findings[]` or `MOCK — awaiting Person 2+3`).
- Connection card: `#ws-url` (default `ws://localhost:8080`) + `#ws-connect` Start + `#ws-disconnect` Stop + `#ws-status` dot + hint `Start Node server first — browser cannot spawn it`. Wire to `connectToServer()/close()` + `updateServerStatus()`.
- Progress: freeze/delete header `.pipeline` stepper (legend at most); real progress = per-turn nodes + `#chat-status` (`Thinking… → Perception → Redacting → … → Complete`), ~3s fast / ~6.5s normal + toggle.
- Delete ALL remaining mocks: `scenarios` hotel copy, `type{el_1,"Mumbai"}/select{el_4,"3 Adults"}/click{el_5}`, server `el_1..el_7` clear values, `runDemoSequence`, seeded TravelEase page.
Verify: §0 greps = 0; header never lights; stopped → red, running → green, chat-offline → inline error.

## Acceptance (run before review)

1. Fresh clone → both terminals → green Connected.
2. Chat task → thinking → trace fills → SAFE/BLOCKED inline + `pending_id` → Approve → `action_update ok`.
3. Inspector shows same sanitized JSON; privacy chip visible; no Live Browser panel.
4. `type` uses `value`, `submit` sends `element_id`, `scroll` returns `scroll_y`.
5. Ping me + Person 1 (validator/schema), Person 2+3 (payload). Don't push broken contract — we demo validator, not TravelEase.
