# PerScope Playground

Manual-side test console for the real PerScope runtime: pair with the bridge,
fire tool calls by hand, and see exactly what an AI agent would see. The UI
renders — it never decides, never executes, never validates.

## Bring-up order (strict)

1. Bridge daemon: `node ../bridge/bin/cli.js daemon` (or the published
   `npx @perscope/bridge mcp` once `0.2.0` ships) — note the pairing code.
2. Extension paired (its dashboard card) — see `extension/v7 beta/BRIDGE-WIRING-LOG.md`.
3. Playground paired (connection card → code → Pair).
4. Run: Manual card (tab picker + tool sender), Screen State `capture_tab`,
   or chat (scripted flows only — model loop deferred, see below).

## Scripts

- `npm start` / `npm run serve` — static UI on `:3000` (default path; serves nothing canned).
- `npm run mock` — explicit-only fake `:8080` world for offline UI dev. Bannered DEMO ONLY, frozen, never the default.
- `npm test` — transport + contract suites against a real bridge daemon (no mock in the path).

## How it connects

- **WS agent leg (primary):** `ui/runtime-client.js` pairs (`role:"agent"`) and holds blocking calls (70s ceiling) against the bridge WS. Statuses: red down / orange reachable-unpaired / green paired.
- **MCP leg:** same tools over the bridge's stdio/HTTP transports (demo scripts deferred — T4).
- No push, no polling, no `pending_id` anywhere. Approval happens in the extension; verdicts arrive as terminal `ok` / `denied` / `timeout`.
- Tokens live in the transport closure + browser storage; they never reach panes, logs, or the inspector.

## Status

Built: WS leg, pairing UI, tab picker (`list_tabs`), generic sender, `capture_tab` rendering, mock retirement. Deferred: chat-side model loop (T6, PS-required), MCP-show demos (T4), action execution paths (need T6d). Honest beta errors (`dom-not-implemented-in-beta`, `extension-busy`) display verbatim.
