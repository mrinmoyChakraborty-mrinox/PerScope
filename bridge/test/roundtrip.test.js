import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MockExtension, startTestDaemon } from "./helpers.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const CANNED_CAPTURE = { status: "ok", redactedImage: "aGVsbG8=", evidence: { findings: [{ type: "EMAIL" }] } };

function parseToolText(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

test("capture_tab round-trips identically over stdio-proxy and HTTP", async () => {
  const { dir, daemon, ports } = await startTestDaemon();

  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  ext.onTool("capture_tab", async () => ({ ...CANNED_CAPTURE }));
  await ext.pair(daemon.getPairingCode().code);

  // --- HTTP transport ---
  const httpClient = new Client({ name: "roundtrip-http", version: "0.0.0" });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ports.httpPort}/mcp`)));
  const viaHttp = parseToolText(await httpClient.callTool({ name: "capture_tab", arguments: {} }));
  await httpClient.close();

  // --- stdio transport (through the mcp proxy subprocess) ---
  const stdioClient = new Client({ name: "roundtrip-stdio", version: "0.0.0" });
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp"],
    env: { ...process.env, PERSCOPE_BRIDGE_DIR: dir },
  });
  await stdioClient.connect(stdioTransport);
  const viaStdio = parseToolText(await stdioClient.callTool({ name: "capture_tab", arguments: {} }));
  await stdioClient.close();

  // The bridge relays opaquely: identical canned response on both, and the
  // request actually reached the mock extension. (Each call gets its own
  // correlation id, so compare payloads with id excluded.)
  const { id: _httpId, ...httpPayload } = viaHttp;
  const { id: _stdioId, ...stdioPayload } = viaStdio;
  assert.deepEqual(httpPayload, stdioPayload);
  assert.equal(viaHttp.status, "ok");
  assert.equal(viaHttp.redactedImage, CANNED_CAPTURE.redactedImage);
  assert.deepEqual(viaHttp.evidence, CANNED_CAPTURE.evidence);
  assert.ok(viaHttp.id, "correlated response keeps its id");
  assert.ok(viaStdio.id, "correlated response keeps its id");
  assert.ok(!("auth" in viaHttp), "extension token must never leak to agents");
  assert.equal(ext.received.length, 2);
  assert.deepEqual(ext.received.map((m) => m.tool), ["capture_tab", "capture_tab"]);

  await ext.close();
  await daemon.close();
});

test("click blocks and relays the extension verdict (no polling)", async () => {
  const { daemon, ports } = await startTestDaemon();
  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  ext.onTool("click", async () => {
    await new Promise((resolve) => setTimeout(resolve, 300)); // Approve/Deny dwell
    return { status: "denied" };
  });
  await ext.pair(daemon.getPairingCode().code);

  const httpClient = new Client({ name: "confirm-http", version: "0.0.0" });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ports.httpPort}/mcp`)));
  const started = Date.now();
  const result = parseToolText(await httpClient.callTool({ name: "click", arguments: { ref: "el_3" } }));
  const elapsed = Date.now() - started;
  await httpClient.close();

  assert.equal(result.status, "denied");
  assert.ok(elapsed >= 250, `call returned in ${elapsed}ms without waiting for the verdict`);
  assert.equal(ext.received[0].params.ref, "el_3");

  await ext.close();
  await daemon.close();
});

test("tool call with no extension connected is an error, not a hang", async () => {
  const { daemon, ports } = await startTestDaemon();
  const httpClient = new Client({ name: "noext-http", version: "0.0.0" });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ports.httpPort}/mcp`)));
  const result = await httpClient.callTool({ name: "read_page", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no paired extension/);
  await httpClient.close();
  await daemon.close();
});
