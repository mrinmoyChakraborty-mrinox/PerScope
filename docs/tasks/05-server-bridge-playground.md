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

## Citations (corrected per Person 6)

- Server model: **Qwen3**, not Qwen2.5 (dated generation).
- MCP: `modelcontextprotocol.io/specification/2025-06-18/architecture`.
