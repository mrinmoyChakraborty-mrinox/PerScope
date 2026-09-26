# @perscope/bridge

Local message-relay bridge for the PerScope Chrome extension. One sentence: a local
Node daemon holds a paired WebSocket connection to the extension and exposes an MCP
server (stdio + streamable-HTTP) so any MCP client can drive the extension through a
fixed tool schema.

**The bridge makes no decisions and executes nothing.** It relays
`{id, tool, params}` messages between agents and the extension. All
safety/destructive-action logic (`isDestructive()`, Approve/Deny) lives in the
extension — this package performs only JSON-shape validation (zod input schemas),
and anything that looks like a safety judgment belongs in the extension, not here.

## Install & run

```bash
cd bridge
npm install

# Terminal 1: long-running daemon (keeps the bridge alive persistently)
npx perscope-bridge daemon
# prints the pairing code + dashboard URL, stays running until killed
```

## Register with your agent

The `mcp` subcommand is what goes in the agent config. It never becomes the
extension-facing server itself: it finds-or-spawns a detached singleton daemon,
then proxies its own stdio JSON-RPC to that daemon. Any number of agents (Claude
Code *and* OpenCode at once) each get their own stdio subprocess, all talking to
the same daemon — exactly one extension-facing WS server, one pairing state.

```bash
# Claude Code
claude mcp add perscope -- npx -y @perscope/bridge mcp
```

```jsonc
// OpenCode (opencode.json)
{ "mcp": { "perscope": { "type": "local", "command": ["npx", "-y", "@perscope/bridge", "mcp"] } } }
```

For a published package, replace the local path with the npm spec above. For local
development, point the command at this directory:

```jsonc
{ "mcp": { "perscope": { "type": "local", "command": ["node", "C:/path/to/PERSCOPE/bridge/bin/cli.js", "mcp"] } } }
```

Remote/browser agents use the streamable-HTTP transport instead:
`http://127.0.0.1:7332/mcp` (same tools, same handlers).

## Pairing (do once per client)

1. Start the daemon: `npx perscope-bridge daemon`.
2. Read the 6-digit pairing code from stdout or the dashboard (`http://127.0.0.1:7332/` — a fresh code is always shown; used codes rotate immediately).
3. Enter it once in the extension's options page (or the playground's pairing card). The client sends `{type:"pair", code[, role:"agent"]}` over WS; the daemon replies with a persistent secret token, stored in `~/.perscope/paired-clients.json` (mode 0600).
4. On reconnects the client sends `{type:"hello", auth:"<token>"[, role:"agent"]}` and every subsequent message carries top-level `auth`. Sockets without a valid token — or with a role mismatching their stored record — are answered with an error and closed.

Pairing codes are single-use, expire after 10 minutes, and lock for 60s after 5
wrong guesses (a fresh code is generated and shown on the dashboard).

## Agent sockets (playground / direct WS clients)

Beyond the extension, the WS server accepts **agent-role** clients (the playground Manual side, test scripts): they pair like above with `role:"agent"`, send `{id, tool, params, auth}`, and get terminal `{id, status, ...}` replies. Agent ids are remapped to internal UUIDs on the extension leg (concurrent agents can share request ids safely); duplicate in-flight ids get `{status:"error", reason:"duplicate-id"}`. Extension-bound calls never route to agent sockets. In-repo since T1; ships in `0.2.0` (published `0.1.0` is extension + MCP only).

## Tools

`capture_tab`, `read_page`, `list_interactive_elements`, `list_tabs`, `click`, `type`,
`select_option`, `submit`, `scroll` — identical on stdio and HTTP. Each handler
validates params shape, forwards `{id, tool, params}` to the paired extension,
and awaits the correlated response (default 60s). `click`/`type`/`select_option`/
`submit` simply hold the call open until the extension answers `ok`, `denied`,
or `timeout` — no polling tool, no push mechanism.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PERSCOPE_BRIDGE_PORT` | `7331` | Extension-facing WS port (127.0.0.1 only) |
| `PERSCOPE_BRIDGE_HTTP_PORT` | `7332` | Dashboard + MCP streamable-HTTP port (127.0.0.1 only) |
| `PERSCOPE_BRIDGE_RELAY_PORT` | `7333` | Internal stdio-proxy relay (127.0.0.1 only) |
| `PERSCOPE_BRIDGE_DIR` | `~/.perscope` | Lockfile + paired-clients storage |
| `PERSCOPE_TOOL_TIMEOUT_MS` | `60000` | Blocking-call ceiling per tool |

## Layout

```
package.json  bin/cli.js (daemon|mcp)
src/config.js src/pairing.js src/lockfile.js src/ws-server.js
src/mcp-server.js src/mcp-stdio-proxy.js src/daemon.js src/version.js
src/tools/    one file per tool (name + description + zod inputSchema)
test/         pairing, lockfile, ws-auth, roundtrip (both transports), stdio-purity
```

## Security contract (what this package will NOT do)

- No `isDestructive()` or equivalent judgment — extension side only.
- No caching, logging, or persisting of images, evidence, or page content beyond
  a single in-flight request/response pair.
- No non-localhost listeners: WS, HTTP, and relay all bind `127.0.0.1`.
- The `mcp` subprocess never writes anything but MCP JSON-RPC frames to stdout
  (all diagnostics to stderr); a regression test enforces this.
- HTTP MCP transport is localhost-only with no auth token by deliberate decision:
  any local process can call tools, but destructive actions still gate on the
  extension's human Approve/Deny prompt.

## Tests

```bash
npm test   # node --test, sequential (localhost ports are shared)
```
