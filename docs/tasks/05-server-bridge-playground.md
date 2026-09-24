# Person 5 — Server-Side / Demo Agent Client + MCP Bridge + Reasoning Server (Banashree)

**Scope expanded — highest-risk item on tracker: now three deliverables, not two.** Pair with Person 1 early; start Reasoning Server **in parallel with Playground, not after**.

## A. Playground — unchanged (primary on-stage instrument)

- Node WebSocket server/client at `playground/` — same WS URL, same scripted demo sequence (trigger buttons, `"what the agent sees"` panel showing sanitized context).
- Uses `docs/tool-schema.md` 7-tool schema directly.
- Must be testable against real merged perception+redaction payload from Person 2+3 as soon as it exists — not long on mocked data.

## B. MCP Bridge — unchanged (real-agent proof, thin translator)

- Package at `bridge/package.json` (`@modelcontextprotocol/sdk`).
- **Zero logic:** stdio ⇄ WebSocket translator, auto-spawned. Translates:
  - MCP `tools/list` → advertises 7 tools from `tool-schema.md` (with `inputSchema` per tool)
  - MCP `tools/call` → `{id, tool, params}` WebSocket
  - WebSocket `result`/`blocked`/`error` → MCP `tools/call` result (passes `result` field unchanged)
- Must preserve `blocked` + `pending_id` semantics — no reinterpretation.

### Open gap (with Person 1, before finals)

MCP `tools/call` is **request/response only** — cannot carry unsolicited `action_update` push. Current bridge returns `{status:"blocked", pending_id}` and stops; agent never learns `approved`/`denied`/`timeout`.

**Decide:** add polling tool `check_pending_action` (new 8th tool, queried by agent) **or** hold MCP response open until `action_update` arrives (if transport allows). Track decision in `tool-schema.md`.

## C. PerScope Reasoning Server — **NEW, REQUIRED (the actual PS deliverable)**

This did not exist in v2. It is the **literal PS requirement**: transmit sanitized context to a centralized open-weight LLM/VLM and get actionable commands back.

### Concrete Tasks

1. **Self-host Qwen3 family (not 2.5).** Use **vLLM or Ollama**; model target: Qwen3 (e.g. `Qwen/Qwen3-2B` / `Qwen/Qwen3-7B`, Apache 2.0). During SIH, **rented GPU for latency is permitted** — state it plainly on stage, not as laptop inference. Offline path is the real deliverable.

2. **Constrain output to 7-tool schema** via structured/function-calling. Server input = sanitized context only (from `list_interactive_elements` result) — **never raw DOM/screenshot**. Output = **exactly** `{tool, params}` shapes from `tool-schema.md` — never free-form prose actions. This is what lets validator/Dashboard/confirm-flow treat server identically to Playground/bridge.

3. **Multi-turn behavior.** Server can return **terminal action** (e.g. `click`) **or** request for more evidence (e.g. `scroll` then re-evaluate) — do not build single-shot.

4. **Integration-test against real payload early** — the moment Person 2/3's pipeline produces real sanitized JSON. Pair with Person 1 immediately.

5. **Package & run.** `server/package.json` with `vllm` or `ollama` client, `server/index.js` exposes WS server on same port as bridge/playground (distinguished by path or just multiplexed — PerScope doesn't care, same validator).

### Files

- `playground/index.js` (+ `playground.html`)
- `bridge/index.js` (+ `bridge/package.json`)
- `server/index.js` (+ `server/package.json` with `qwen3` model config, `vllm`/`ollama` deps)

### Why this is highest risk

Net-new, biggest scope, and required — unlike bridge (bonus). Treat as equal priority to Playground from day one.

## D. URGENT — Playground audit follow-ups (added 2026-09-15, Person 5 Banashree)

Fix 1 DONE: `playground/playground/` flattened to `playground/` (`js/{client,demo,server} + ui/playground.html,css,js`); `perscopee.*` renamed; stale refs cleared; zero `perscopee` matches remain. `package.json main:index.js` still dangles — covered below.

Pinned in `docs/data/pinned.json` (`status:urgent`, due 2026-09-18). Work top-down:

2. `playground-ws-single` — single WS client, no auto-run (`ui/playground.js` wins; demote `js/client/websocket-client.js`).
3. `playground-schema-parity` — `text`→`value`, `option`→`value`, `submit`+`element_id`, `scroll`/`click` shapes per `docs/tool-schema.md`.
4. `playground-validator-flow` — real `isDestructive()` + `blocked/pending_id` + `action_update` + Approve/Deny + 60s timeout (with Person 1).
5. `playground-keepalive-errors` — `ping`↔`pong` 20s + timeouts + `error/blocked` UI + `addEvent(msg,status,source)` unification.
6. `playground-sanitized-truth` — kill fake `3/3/PASS`, redact mock values, add real Person 2+3 payload adapter (with Person 2+3).
7. `playground-ui-deadweight` — remove Pause/dead Execute/dup scenario controls/2nd theme toggle/latency hack; fix badges + agent-input show logic.
8. `playground-packaging` — runnable `playground/package.json` scripts + `playground/README.md`.

> NOTE 2026-09-16 redesign (Section E below) SUPERSEDES parts of D:
> Live Browser / TravelEase mock, Privacy Summary panel, and hardcoded
> `3/3/PASS` + `Email/Phone/Card` are now DELETED, not fixed. Do not polish
> them — delete per E1/E3/E4. Tasks 2–5, 8 still apply, re-targeted at the
> new chat UI.

## E. REDESIGN — Chat-first Playground (added 2026-09-16, Person 5 Banashree, P0)

Single source for your work. Read D above as background, build E below.
Reference implementations: `claude_process_chat_mock.html` (chat + in-chat
progress pattern to copy), current `playground/ui/playground.html|css|js`
(delete pattern), `docs/tool-schema.md` (contract — never violate).

### E0. Goal / non-goals

- Goal: chat box where user types a task → local reasoning model path runs
  → per-turn Perceive → Protect → Reason → Act trace renders INSIDE that
  chat turn → validator-gated tool calls execute over WS.
- Non-goals: no TravelEase browser clone, no fake hotel demo, no top-header
  fake progress, no hardcoded privacy numbers. No new deps without Person 1.
- Layout after rework: left sidebar (session + WS connection + tools) |
  center chat (composer + turns + in-turn progress) | right/bottom inspector
  (Screen State sanitized-only + Event Log + Tool Request/Response). No
  Live Browser column.

### E1. Delete Live Browser View (remove, do not restyle)

Files: `playground/ui/playground.html` (~`#live-view`,
`.mock-browser-content`, `#mock-destination`, `#mock-guests`,
`#mock-search-button`), `playground/ui/playground.css` (all
`mock-browser-*`, `browser-window/*` rules), `playground/ui/playground.js`
(`runNormalDemo` TravelEase steps, hardcoded `el_1..el_7`,
`Click on "Search Hotels"`).

Do:
1. Delete entire `<section id="live-view">` + mock nav/hero/search-box.
2. Delete `scenarios.normal` TravelEase copy ("Find a hotel in Mumbai…") and
   any `updatePage({title:"TravelEase…"})` seed. Do not replace with another
   fake site.
3. Delete `summary[2].textContent = "${count} interactive"` hotel logic if
   tied to mock; re-derive from real WS `list_interactive_elements` or hide
   until first chat turn returns.
4. Verify: `rg -i "travelease|mock-destination|mock-search|Search Hotels" playground/` returns 0 hits.

### E2. Add Chat section (copy `claude_process_chat_mock.html` pattern)

Files: `playground/ui/playground.html`, `playground.css`, `playground.js`
(new `chat/` block or extend existing `agent-input-panel`).

Copy from mock (root `claude_process_chat_mock.html:96-138,141-246`):
- `.chatWrap > .chat > .msg.user/.assistant` + `.avatar` + `.bubble`.
- `#thinkingCard` (Thinking glyph + rotating `Thinking…/Reasoning…/
  Planning…/Refining…` + shimmer) — hidden until send.
- `#process > .tree > .node (Perception, Redacting, Reasoning, Acting upon,
  Done)` with `.nodeDot`, `.nodeHeader/.nodeMeta/.nodeBody`, `.branch`.
  `runFlow()` appends both to bottom of current turn, shows thinking
  ~3–6.5s, then swaps to process trace (`process.classList.add("show")`).
- `.composer > .composerInner > textarea + .send` + `.status`.

Do:
1. Add `<section id="chat-panel" class="panel chat-panel">` with
   `#chatWrap > #chat + #thinkingCard + #process` + footer composer
   (`#chat-input`, `#chat-send`, `#chat-status`). Wire Enter-to-send
   (Enter, Shift+Enter newline) + auto-resize like mock `:231-238`.
2. `submitChat()`: `addMessage(text,"user")` → assistant placeholder
   `Processing your request…` → `runFlow()` → WS sequence
   `read_page → list_interactive_elements → <model decision> → click/type/…`
   Each step appends/updates the nodes of THIS turn only (move
   `thinkingCard`+`process` via `chat.appendChild(...)` per turn as mock
   `:177-178` does). Never reuse one global trace across turns.
3. Map pipeline → nodes: Perception=`read_page` result,
   Redacting=sanitized findings count, Reasoning=`agent-reasoning` text,
   Acting upon=`click/type/submit` request+validator verdict,
   Done=`ok/blocked/denied/timeout`. Blocked turns render Approve/Deny
   buttons inline in the Acting node (see E5/E6 of validator task 4).
4. Keep existing `#agent-reasoning`, `#tool-request`, `#tool-response`
   inspector panes — update them from chat flow instead of demo buttons.
   Delete `Start Demo / scenario-select / scenario-cards` auto-run path;
   chat send is the only trigger (keep one scenario picker ONLY if judges
   need destructive/injection shortcuts — as preset chat prompts, not
   separate runner).
5. Verify: send "hello" → user bubble + thinking animation + 5-node trace
   appears inside same turn + status line updates. Second send starts a
   clean new turn (old trace stays collapsed above).

### E3. Privacy Summary — remove panel, move to inline chip

Files: `playground/ui/playground.html` (`#privacy-summary`), `playground.js`
(`updatePrivacySummary():727-736` hardcoded `3/3/PASS` + `Email/Phone/Card`
list), `playground.css` (`privacy-summary-panel`, `summary-grid`).

Do:
1. Delete `<section id="privacy-summary">` from main grid. Do NOT show
   PII counts as a top-level card.
2. Replace with: (a) small `🔒 sanitized-only` chip in chat header +
   (b) collapsible `<details id="privacy-details">` inside Screen State
   panel showing real `findings[]` from WS (`candidate_types/sources/
   confidence`), or `MOCK — awaiting Person 2+3 payload` if empty.
3. Delete hardcoded `$("pii-count")="3"` etc. Derive from
   `demoState.lastResponse.result.findings.length` or hide.
4. Verify: no `pii-count/sanitized-count/audit-status` IDs in HTML; no
   Email/Phone/Card strings in `playground/`.

### E4. Remove mock demo data COMPLETELY (not relabel)

Delete list (all must go):
- `ui/playground.js: scenarios{normal,destructive,injection}` hotel copy,
  `setNextAction('Click on "Search Hotels"')`, hardcoded
  `type{el_1,"Mumbai"} / select_option{el_4,"3 Adults"} / click{el_5}` chain.
- `js/server/websocket-server.js: mockElements el_1..el_7`
  (`Mumbai, 12/06/2025…` in clear) + `result:{clicked:true,label}` extras.
- `js/client/websocket-client.js: runDemoSequence()` auto-run on open.
- `js/demo/demo-state.js`: any seeded TravelEase page/elements.

Do:
1. Server returns MINIMAL honest stub + adapter hook, per
   `tool-schema.md:62-85` (`[REDACTED:TYPE]` values only):
   ```js
   // TODO(Person 2+3): replace mockElements with real sanitized JSON
   // const sanitized = await getRealPipelineResult()
   // {elements:[{id,type,label,value:"[REDACTED:EMAIL]",bbox}],findings,confidence}
   ```
2. Chat flow handles empty/error honestly: `status:error/element_not_found`
   renders in turn + Event Log, no fake success.
3. Verify: `rg -i "mumbai|travelease|Search Hotels|2 Adults|Email.*Phone.*Card" playground/` → 0 hits (except TODO comments).

### E5. Progress bar INSIDE chat (not header)

Current header `.pipeline #step-perceive…#step-repeat` is static/fake —
either delete or freeze as legend. Real progress = E2 thinking/process
per turn.

Do:
1. Remove `setPipelineStep("perceive|protect|reason|act")` calls from chat
   flow OR re-point them to update the CURRENT turn's `.node.done`
   classes (preferred: per-turn nodes get `.done` as each WS call returns).
2. Thinking (~3s fast / ~6.5s normal + Fast/Normal toggle like mock
   `#speed`) → process nodes stagger-animate (`.node:nth-child` delays
   already in mock CSS `:72`). Keep `status` line per turn
   (`Thinking… → Perception → Redacting → … → Complete`).
3. Verify: no global header step lights up on chat send; only the active
   turn animates.

### E6. WebSocket section — real Start/Connect button + extension hook

Files: `playground/ui/playground.html` (`settings-content .connection-label`
static `● Connected`), `playground.js` (`connectToServer():129-178`,
`updateServerStatus()`, `SERVER_URL="ws://localhost:8080"`),
`playground/package.json`, new `playground/README.md`.

Do:
1. Add Connection card (sidebar or settings): `#ws-url` input (default
   `ws://localhost:8080`) + `#ws-connect` (Start) + `#ws-disconnect`
   (Stop) + `#ws-status` dot + `#ws-log` hint. `ws-connect` calls
   `connectToServer()`; `ws-disconnect` closes socket. Status dot red/
   green via existing `updateServerStatus()`. Auto-connect on load is
   OPTIONAL — manual Start must always work (judge clicks Start → green
   Connected + `Connected to WebSocket server` event).
2. Document two-terminal run in `playground/README.md` + package scripts:
   `npm start` → `node js/server/websocket-server.js`
   (`WebSocket server running on ws://localhost:8080`), `npm run serve` →
   static `ui/` on `:3000`. Browser cannot spawn the Node server — the
   button connects the client; the server terminal must already run. Say
   this explicitly in the UI hint text.
3. Extension hook: same `{id,tool,params}` schema — add comment + README
   note: extension SW connects to same WS URL as second client; server
   multiplexes by `client` role. No extension code in this task — just do
   not break the contract (keep `ping/pong`, `action_update`,
   `stale_element`, `blocked/pending_id` from tasks 4–5).
4. Verify: server stopped → Start shows red Disconnected + warning log.
   Server running → Start → green Connected. Chat send while disconnected
   → inline `WebSocket server is not connected` error, no hang (5s timeout
   + reject path).

### E7. Order + acceptance (do in this order)

1. E1+E4 delete mock (unblocks everything) → 2. E2 chat shell with mock
   `runFlow()` only → 3. wire chat→WS real tools + E5 per-turn progress →
   4. E3 privacy chip + 5. E6 WS Start/Stop + 6. old tasks 3 (schema parity:
   `value`, `submit{element_id}`, `scroll{scroll_y}`), 4 (validator
   Approve/Deny inline in chat), 5 (ping/pong+errors), 8 (packaging).
2. Final `rg` gates: 0 hits for TravelEase/Mumbai/Search Hotels/Email-
   Phone-Card mocks; `sendRequest("type",{element_id,value})` shape;
   blocked destructive turn shows Approve/Deny + `pending_id`.
3. Demo script: open `ui/` → Start (WS) → type "book hotel for 2" in chat
   → thinking → trace fills → validator SAFE/BLOCKED inline → inspector
   shows same sanitized JSON agent saw. Privacy chip visible, no Live
   Browser panel anywhere.

## Citations (corrected per Person 6)

- Server model: **Qwen3**, not Qwen2.5 (dated generation).
- MCP: `modelcontextprotocol.io/specification/2025-06-18/architecture`.
