import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDaemon } from "../../bridge/src/daemon.js";
import { MockExtension } from "../../bridge/test/helpers.js";
import { createRuntimeClient } from "../ui/runtime-client.js";

// Tool-contract suite: every result below is asserted against the real
// bridge + a mock extension speaking the CURRENT schema (ref/tabId,
// terminal ok|denied|timeout|error). This replaces the old mock-server
// schema-test, whose click/el_8 case asserted status "ok" against a mock
// that itself blocked the action — a self-contradiction. The fixed
// assertion below expects the honest terminal verdict instead.

const mem = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
};

async function pairedClient() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pg-schema-"));
  const daemon = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 8000 });
  const ext = new MockExtension(daemon.ports.wsPort);
  await ext.connect();
  ext.onTool("capture_tab", async (p) => ({
    status: "ok",
    redactedImage: "aGVsbG8=",
    evidence: { findings: [] },
    tab: p.tabId ?? "active",
  }));
  ext.onTool("read_page", async () => ({ status: "ok", sanitizedText: "t", findings: [] }));
  ext.onTool("list_interactive_elements", async () => ({
    status: "ok",
    elements: [{ ref: "el_1", tag: "button", label: "Go", role: "button" }],
  }));
  ext.onTool("list_tabs", async () => ({
    status: "ok",
    tabs: [{ tabId: 9, title: "T", url: "https://t/", active: true }],
    titlesAvailable: true,
  }));
  ext.onTool("click", async () => ({ status: "denied" }));
  ext.onTool("type", async () => ({ status: "ok" }));
  ext.onTool("select_option", async () => ({ status: "ok" }));
  ext.onTool("submit", async () => ({ status: "timeout" }));
  ext.onTool("scroll", async () => ({ status: "ok" }));
  await ext.pair(daemon.getPairingCode().code);
  const client = createRuntimeClient({ url: `ws://127.0.0.1:${daemon.ports.wsPort}`, storage: mem() });
  await client.connect();
  await client.pair(daemon.getPairingCode().code);
  return { daemon, ext, client };
}

test("schema: read tools return their documented shapes", async () => {
  const { daemon, ext, client } = await pairedClient();
  const cap = await client.callTool("capture_tab", {});
  assert.equal(cap.status, "ok");
  assert.ok(typeof cap.redactedImage === "string" && cap.redactedImage.length > 0);
  assert.ok(cap.evidence && typeof cap.evidence === "object");
  const listed = await client.callTool("list_interactive_elements", {});
  assert.deepEqual(Object.keys(listed.elements[0]).sort(), ["label", "ref", "role", "tag"]);
  const tabs = await client.callTool("list_tabs", {});
  assert.deepEqual(tabs.tabs, [{ tabId: 9, title: "T", url: "https://t/", active: true }]);
  assert.equal(tabs.titlesAvailable, true);
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("schema: destructive click resolves denied, never ok-by-default", async () => {
  // Was: `if (clickResponse.status !== "ok") throw` — asserting ok against
  // a mock that blocks el_8. Now: the honest terminal verdict is asserted.
  const { daemon, ext, client } = await pairedClient();
  const res = await client.callTool("click", { ref: "el_8" });
  assert.equal(res.status, "denied");
  assert.notEqual(res.status, "ok");
  assert.deepEqual(ext.received[0].params, { ref: "el_8" });
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("schema: action tools accept ref shapes; timeout is terminal", async () => {
  const { daemon, ext, client } = await pairedClient();
  assert.equal((await client.callTool("type", { ref: "el_1", text: "hi" })).status, "ok");
  assert.equal((await client.callTool("select_option", { ref: "el_2", value: "IN" })).status, "ok");
  assert.equal((await client.callTool("scroll", { direction: "down", amount: 100 })).status, "ok");
  assert.equal((await client.callTool("submit", { ref: "el_3" })).status, "timeout");
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("schema: unknown tool is an honest error, not silence", async () => {
  const { daemon, ext, client } = await pairedClient();
  const res = await client.callTool("nope_nothing", {});
  assert.equal(res.status, "error");
  client.disconnect();
  await ext.close();
  await daemon.close();
});
