/* PerScope benchmark harness — bridge MCP client (Node, zero dependencies).
   Reuses the exact wire pattern from playground/ui/agent-loop.js
   fetchMcpTools: plain JSON-RPC POST to /mcp (the daemon serves stateless
   mode, no initialize handshake), with the same SSE data-frame fallback.
   The daemon relays with its own privilege on localhost, so this client
   needs no pairing of its own — but the EXTENSION must be paired, which
   preflight checks prove before any timed run starts. */

export const DEFAULT_MCP_URL = "http://127.0.0.1:7332/mcp";
export const DEFAULT_HEALTH_URL = "http://127.0.0.1:7332/health";

function parseMcpBody(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const frame = String(raw)
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!frame) throw new Error("bridge MCP answered non-JSON, non-SSE");
    return JSON.parse(frame.slice("data:".length).trim());
  }
}

async function postRpc(url, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`bridge MCP answered HTTP ${res.status}`);
    return parseMcpBody(await res.text());
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`bridge MCP call timed out after ${timeoutMs}ms`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Daemon liveness + pairing census. Throws with a bring-up hint. */
export async function checkHealth(healthUrl = DEFAULT_HEALTH_URL, timeoutMs = 8000) {
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch(healthUrl, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    throw new Error(
      `bridge daemon is not reachable at ${healthUrl} — start it first ` +
        `(bridge/bin/cli.js daemon), then re-run.`,
    );
  }
  if (!res.ok) throw new Error(`bridge /health answered HTTP ${res.status} — is the daemon healthy?`);
  return res.json();
}

/** Single MCP tool call. Returns the tool's result object; throws on transport or tool error. */
export async function callTool(mcpUrl, name, args = {}, timeoutMs = 600_000) {
  const data = await postRpc(
    mcpUrl,
    { jsonrpc: "2.0", id: `bench-${Date.now()}`, method: "tools/call", params: { name, arguments: args } },
    timeoutMs,
  );
  if (data?.error) throw new Error(`bridge MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  const content = data?.result?.content;
  const text = Array.isArray(content) ? content.find((c) => c?.type === "text")?.text : null;
  if (typeof text !== "string") throw new Error(`bridge MCP returned no text content for ${name}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`bridge MCP returned non-JSON text for ${name}: ${text.slice(0, 200)}`);
  }
  if (data?.result?.isError || parsed?.status === "error" || parsed?.status === "denied" || parsed?.status === "timeout") {
    throw new Error(`${name} ended with status "${parsed?.status ?? "error"}": ${parsed?.reason ?? text.slice(0, 300)}`);
  }
  if (typeof parsed?.status === "string" && parsed.status !== "ok") {
    throw new Error(`${name} ended with status "${parsed.status}": ${(parsed?.reason || "").slice(0, 300)}`);
  }
  return parsed;
}

export async function listTabs(mcpUrl, timeoutMs = 15_000) {
  const res = await callTool(mcpUrl, "list_tabs", {}, timeoutMs);
  if (!Array.isArray(res.tabs)) throw new Error("list_tabs returned no tab array — is the extension paired?");
  return res.tabs;
}
