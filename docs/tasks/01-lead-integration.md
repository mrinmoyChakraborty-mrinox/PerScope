# Person 1 — Team Lead / Systems Integration

**Role:** owns tool schema, keepalive, offscreen trigger decision, action validator co-ownership, and integration across three callers.

## Concrete Tasks (v3)

1. **Tool schema — 7 tools.** Maintain `docs/tool-schema.md` with `read_page`, `list_interactive_elements`, `click`, `type`, `submit`, **`select_option`** (`{element_id, value}` for `<select>`), **`scroll`** (`{direction:"up"|"down", amount:"page"|int}` — **never validator-gated**). Envelope is `{id, tool, params}` ↔ `{id, status:"ok"|"blocked"|"error", result|reason|pending_id}`.

2. **Keepalive ping.** `background.js` sends `{type:"ping"}` every 20s, expects `{type:"pong"}`; service worker would be killed idle otherwise (Chrome 116+). Keep from day one.

3. **Offscreen trigger / reason decision with Person 4.** Decide when `background.js` creates `offscreen.js` and which caller triggered it — unchanged in principle, revisit because offscreen now hosts 4 models not 1.

4. **Co-own action validator with Person 4.** `isDestructive({tool, params, element})` — confirm uniform application to **three** callers (Playground, Bridge, Reasoning Server) + prompt-injection text. No caller gets a shortcut.

5. **Pair with Person 2 if any extractor stalls.** Three extractors = three failure points (DOM, PaddleOCR, Florence).

6. **Pair with Person 5 on Reasoning Server as soon as minimal version exists.** This is the PS-required deliverable — not last-minute.

7. **Own open gap: MCP confirm-flow.** MCP `tools/call` is request/response only; unsolicited `action_update` push has no transport. Decide with Person 5 before finals: **polling tool `check_pending_action`** vs **holding MCP response open** if transport allows. Document decision in `tool-schema.md` § How a blocked result surfaces.

8. **Review bridge translation layer with Person 5.** Verify `tools/list`/`tools/call` ↔ WebSocket translation is zero-logic, preserves `blocked`/`pending_id` semantics.

## Deliverables

- `docs/tool-schema.md` (7 tools, keepalive, gap note)
- `extension/background/background.js` — validator + keepalive + 3-caller multiplex
- Integration test harness covering Playground, Bridge, Reasoning Server
