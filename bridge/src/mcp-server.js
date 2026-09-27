import express from "express";
import net from "node:net";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { BRIDGE_VERSION } from "./version.js";
import * as captureTab from "./tools/capture_tab.js";
import * as click from "./tools/click.js";
import * as listInteractiveElements from "./tools/list_interactive_elements.js";
import * as listTabs from "./tools/list_tabs.js";
import * as readPage from "./tools/read_page.js";
import * as scroll from "./tools/scroll.js";
import * as selectOption from "./tools/select_option.js";
import * as submit from "./tools/submit.js";
import * as type from "./tools/type.js";

export const TOOL_DEFS = [
  captureTab,
  readPage,
  listInteractiveElements,
  listTabs,
  click,
  type,
  selectOption,
  submit,
  scroll,
];

/**
 * Build one MCP server instance sharing the same tool handlers.
 * Used for EVERY transport (relay sockets, HTTP sessions): identical
 * tool set, identical behavior, no divergent logic.
 *
 * Each handler does nothing but forward {id, tool, params} to the paired
 * extension and return the correlated response. No validation beyond the
 * zod inputSchema (enforced by the SDK), no safety judgments — those live
 * in the extension.
 */
export function createMcpServer(bridge, { toolTimeoutMs } = {}) {
  const server = new McpServer({ name: "perscope-bridge", version: BRIDGE_VERSION });
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => {
        try {
          const result = await bridge.callTool(def.name, args ?? {}, toolTimeoutMs);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `bridge error: ${message}` }], isError: true };
        }
      },
    );
  }
  return server;
}

/**
 * Newline-delimited JSON transport over a TCP socket. Implements the MCP
 * Transport interface (start/send/close + onmessage/onerror/onclose), so a
 * plain `server.connect()` serves full MCP over it. The stdio proxy
 * byte-pipes stdin/stdout to this socket, which is why every proxy
 * connection is a fully valid MCP stdio endpoint.
 */
export class SocketTransport {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
  }

  async start() {
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          this.onerror?.(err instanceof Error ? err : new Error(String(err)));
          continue;
        }
        this.onmessage?.(message);
      }
    });
    this.socket.on("error", (err) => this.onerror?.(err));
    this.socket.on("close", () => this.onclose?.());
  }

  async send(message) {
    return new Promise((resolve, reject) => {
      this.socket.write(JSON.stringify(message) + "\n", (err) => (err ? reject(err) : resolve()));
    });
  }

  async close() {
    this.socket.destroy();
    this.onclose?.();
  }
}

/** Internal relay: one MCP server instance per stdio-proxy connection. */
export async function startRelayServer(bridge, { port, host = "127.0.0.1", toolTimeoutMs } = {}) {
  const tcp = net.createServer(async (socket) => {
    socket.setNoDelay(true);
    const server = createMcpServer(bridge, { toolTimeoutMs });
    const transport = new SocketTransport(socket);
    try {
      await server.connect(transport);
    } catch {
      socket.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    tcp.on("error", reject);
    tcp.listen(port, host, resolve);
  });
  return { tcp, relayPort: tcp.address().port };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderDashboard({ pairing, status, ports }) {
  const code = pairing.code ?? "(no live code right now — check daemon stdout)";
  const clients = (status.clients || []).map((c) => `${c.clientId} (${c.role})`).join(", ") || "none yet";
  const rows = [
    ["Extension", status.extensionConnected ? "connected" : "not connected"],
    ["Paired clients", `${status.pairedClients} — ${clients}`],
    ["Pairing locked", status.pairingLocked ? "yes (back off, then retry)" : "no"],
    ["WS (extension + agents)", `ws://127.0.0.1:${ports.wsPort}`],
    ["MCP (streamable HTTP)", `http://127.0.0.1:${ports.httpPort}/mcp`],
    ["Tools", TOOL_DEFS.map((t) => t.name).join(", ")],
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>PerScope Bridge</title></head>
<body><h1>PerScope Bridge</h1>
<p>Pairing code (enter once in the extension options page): <strong>${escapeHtml(code)}</strong></p>
<table>${rows}</table></body></html>`;
}

/**
 * Localhost-only HTTP surface: dashboard + health + MCP (stateless
 * streamable HTTP — one server instance per request batch, same handlers).
 */
export async function startHttpServer(
  bridge,
  { port, host = "127.0.0.1", toolTimeoutMs, getPairing, getStatus } = {},
) {
  const app = express();
  // Browser callers (the playground page) hit /mcp with a JSON POST, which
  // triggers a CORS preflight. Without ACAO headers + an OPTIONS answer the
  // browser blocks the call as "Failed to fetch" while curl/Node work fine —
  // exactly the confusing split this middleware removes. Same localhost-only
  // shape as the playground forwarder (D8): reflect local origins, answer
  // preflights, add nothing for anyone else (non-browser callers unaffected).
  // Strictly additive: no previously working caller changes behavior.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const local =
      !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (local && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));

  app.get("/", (_req, res) => {
    const ports = { wsPort: bridge.port, httpPort: port };
    res.type("html").send(renderDashboard({ pairing: getPairing(), status: getStatus(), ports }));
  });
  app.get("/health", (_req, res) => res.json({ ok: true, ...getStatus() }));
  // Machine-readable pairing code for `perscope connect` (localhost only —
  // the same code the dashboard HTML already shows to any local viewer).
  app.get("/pairing-code", (_req, res) => {
    const pairing = getPairing();
    res.json(
      pairing.code
        ? { code: pairing.code, expiresAt: pairing.expiresAt }
        : { code: null, expiresAt: pairing.expiresAt ?? null }
    );
  });

  app.all("/mcp", async (req, res) => {
    const server = createMcpServer(bridge, { toolTimeoutMs });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const httpServer = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });
  return { app, httpServer, httpPort: httpServer.address().port };
}
