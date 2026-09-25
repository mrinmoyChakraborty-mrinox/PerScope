# Person 5 (Banashree) — Playground Chat Rework: Whole Task + Guide

`git pull` on `main` first. All work in `playground/` only.
Spec contract: `docs/tool-schema.md` (never violate). Visual pattern: root `claude_process_chat_mock.html`.
Full background: `docs/tasks/05-server-bridge-playground.md` §A–E. This file is your standalone checklist — if it conflicts with §D, this file wins.

Due: P0 / 2026-09-18. No new deps without Person 1.

## 0. Setup (15 min)

1. `cd playground && npm install`
2. Terminal 1: `node js/server/websocket-server.js` → expect `WebSocket server running on ws://localhost:8080`
3. Terminal 2: `npx serve ui -l 3000` → open `http://localhost:3000/playground.html`
4. Open console. Click your new WS Start (Task 6) → green Connected + `Connected to WebSocket server` event. If red, server isn't running — that is correct behaviour, not a bug.
5. Baseline gates (must be 0 after you finish):
   `rg -i "travelease|mock-destination|mock-search|Search Hotels|Mumbai|2 Adults" playground/`
   `rg -i "pii-count|sanitized-count|Email.*Phone.*Card" playground/ui/`

## 1. Delete Live Browser View — `playground/ui/playground.html`

- Delete entire `<section id="live-view">` (`.browser-window`, `.mock-browser-content`, `#mock-destination`, `#mock-guests`, `#mock-search-button`, TravelEase nav/hero/search-box).
- Delete matching CSS (`mock-browser-*`, `browser-window/*`).
- Delete JS that drives it: `runNormalDemo` TravelEase chain, hardcoded `el_1..el_7`, `setNextAction('Click on "Search Hotels"')`.
- Keep layout: sidebar | chat (new) | inspector. No replacement fake site.
- Done when: grep gate above = 0 hits.

## 2. Add Chat section — copy `claude_process_chat_mock.html:96-138,141-246`

Add `<section id="chat-panel" class="panel chat-panel">` in `playground.html`:
- `#chatWrap > #chat` + `#thinkingCard` (glyph + `Thinking…/Reasoning…/Planning…/Refining…` rotator + shimmer) + `#process > .tree > 5x .node` (Perception, Redacting, Reasoning, Acting upon, Done) — copy classes verbatim, rename IDs with `chat-` prefix to avoid collisions.
- Footer composer: `#chat-input` textarea + `#chat-send` + `#chat-status`. Enter sends, Shift+Enter newline, auto-resize (mock `:231-238`).
- Guide — `submitChat()` flow (in `playground.js`):
  1. `addMessage(text,"user")`, clear input
  2. assistant placeholder `Processing your request…`
  3. `chat.appendChild(thinkingCard); chat.appendChild(process)` (per-turn move, mock `:177-178`), show thinking
  4. WS sequence `read_page → list_interactive_elements → model decision → click/type/submit…`, each result marks its `.node` `.done`
  5. Old turns stay; new send starts clean turn.
- Keep `#tool-request / #tool-response / #agent-reasoning / #screen-state / #event-log` inspector panes — feed them from chat flow. Delete `Start Demo / scenario-select / scenario-cards` auto-run; chat send is the only trigger (optional: destructive/injection as preset chat-prompt buttons).
- Done when: send "hello" → bubble + thinking → 5-node trace in same turn; second send = clean new turn.

## 3. Privacy Summary — remove panel, inline chip

- Delete `<section id="privacy-summary">` + `updatePrivacySummary()` hardcoded `3/3/PASS` + Email/Phone/Card list + `summary-grid` CSS.
- Add: (a) `🔒 sanitized-only` chip in chat header, (b) `<details id="privacy-details">` inside Screen State showing real `findings[]` (`candidate_types/sources/confidence`) or `MOCK — awaiting Person 2+3 payload`.
- Done when: no `pii-count/sanitized-count/audit-status` IDs remain.

## 4. Remove ALL mock demo data

Delete: `scenarios{normal,destructive,injection}` hotel copy, `type{el_1,"Mumbai"} / select_option{el_4,"3 Adults"} / click{el_5}` chain, server `mockElements el_1..el_7` in clear, `result:{clicked:true,label}`, client `runDemoSequence()` auto-run on `onopen`, seeded TravelEase page in `demo-state.js`.
- Server stub after cleanup:
  ```js
  // TODO(Person 2+3): replace mockElements with real sanitized JSON
  // const sanitized = await getRealPipelineResult()
  // {elements:[{id,type,label,value:"[REDACTED:EMAIL]",bbox}],findings,confidence}
  ```
  Values must be `[REDACTED:TYPE]` per `tool-schema.md:62-85`.
- Chat shows errors honestly (`error/element_not_found`), no fake success.
- Done when: mock grep = 0 hits (except TODO).

## 5. Progress INSIDE chat (not header)

- Freeze/delete header `.pipeline #step-perceive…#step-repeat` global stepper — or keep as static legend only. Delete `setPipelineStep()` calls from flow, or re-point to current turn's `.node.done`.
- Thinking ~3s fast / ~6.5s normal + Fast/Normal toggle (`#speed` in mock). Nodes stagger via existing `.node:nth-child` delays. Per-turn `#chat-status`: `Thinking… → Perception → Redacting → … → Complete`.
- Done when: header never lights on chat send; only active turn animates.

## 6. WebSocket Start button + extension hook — `playground.html` + `playground.js`

- Add Connection card: `#ws-url` (default `ws://localhost:8080`) + `#ws-connect` Start + `#ws-disconnect` Stop + `#ws-status` dot + hint `Start the Node server first (Terminal 1), then click Start here — browser cannot spawn the server`.
- `ws-connect → connectToServer()`, `ws-disconnect → socket.close()`, reuse `updateServerStatus()` red/green. Manual Start must always work; auto-connect optional.
- Contract to preserve (Person 1 pairs here): `ping↔pong` 20s, 5s request timeout, `error/blocked` in red, `action_update {pending_id, ok|denied|timeout}`, `stale_element`, `blocked+pending_id` + inline Approve/Deny in Acting node + 60s timeout.
- Schema parity (fix while wiring): `type{element_id,value}` (not `text`), `select_option{element_id,value}` (not `option`), `submit{element_id}` (not `{}`), `scroll{direction,amount:page|int}→{scroll_y}`, `click→{status:ok}` bare.
- Single client: `ui/playground.js` wins; demote `js/client/websocket-client.js` to headless smoke-test (remove `onopen → runDemoSequence`).
- Done when: server stopped → red Disconnected + warning; running → green; chat while disconnected → inline error, no hang.

## 7. Packaging — `playground/package.json` + `playground/README.md`

- `main: js/server/websocket-server.js`, scripts: `start: node js/server/websocket-server.js`, `serve: npx serve ui -l 3000`. Remove dangling `main:index.js` + `test: exit 1`.
- `playground/README.md`: two-terminal run + WS URL + extension note (SW connects as second client, same schema, server multiplexes).
- Delete Pause/dead Execute/dup scenario + dup theme toggle/latency hack; fix tool badges (`gated` vs `read`) + `agent-input-panel` hidden-class conflict.

## 8. Final acceptance (run before pinging review)

1. Fresh clone → `npm install && npm start` + `npm run serve` → Connected green.
2. Type task in chat → thinking → trace fills → validator SAFE/BLOCKED inline with Approve/Deny + `pending_id`.
3. Inspector shows same sanitized JSON agent saw; privacy chip visible; no Live Browser anywhere.
4. `rg` gates clean; `sendRequest("type",{element_id,value})` shape; `submit` sends `element_id`.
5. Ping Person 1 (validator/schema) + Person 2+3 (real payload adapter) for review.
