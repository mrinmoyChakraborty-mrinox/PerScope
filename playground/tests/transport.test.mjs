import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDaemon } from "../../bridge/src/daemon.js";
import { MockExtension } from "../../bridge/test/helpers.js";
import { createRuntimeClient, TOOL_TIMEOUT_MS } from "../ui/runtime-client.js";

const mem = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
};

async function boot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pg-transport-"));
  const daemon = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 8000 });
  const ext = new MockExtension(daemon.ports.wsPort);
  await ext.connect();
  ext.onTool("capture_tab", async () => ({
    status: "ok",
    redactedImage: "aGVsbG8=",
    evidence: { findings: [{ type: "EMAIL_ID" }] },
    totalTimeMs: 120,
  }));
  ext.onTool("read_page", async () => ({
    status: "ok",
    sanitizedText: "Hello [REDACTED:EMAIL]",
    findings: [{ type: "EMAIL_ID" }],
  }));
  ext.onTool("click", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return { status: "denied" };
  });
  await ext.pair(daemon.getPairingCode().code);
  return { daemon, ext };
}

test("transport: pair + capture_tab roundtrip through the real bridge", async () => {
  assert.ok(TOOL_TIMEOUT_MS >= 70000);
  const { daemon, ext } = await boot();
  const client = createRuntimeClient({ url: `ws://127.0.0.1:${daemon.ports.wsPort}`, storage: mem() });
  await client.connect();
  assert.deepEqual(await client.pair(daemon.getPairingCode().code), { ok: true });
  const res = await client.callTool("capture_tab", {});
  assert.equal(res.status, "ok");
  assert.equal(res.redactedImage, "aGVsbG8=");
  assert.deepEqual(res.evidence, { findings: [{ type: "EMAIL_ID" }] });
  assert.ok(!("auth" in res), "extension token must never reach the agent surface");
  assert.equal(ext.received.length, 1);
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("transport: honest error resolves as data, not a throw", async () => {
  const { daemon, ext } = await boot();
  const client = createRuntimeClient({ url: `ws://127.0.0.1:${daemon.ports.wsPort}`, storage: mem() });
  await client.connect();
  await client.pair(daemon.getPairingCode().code);
  ext.onTool("read_page", async () => ({ status: "error", reason: "dom-not-implemented-in-beta" }));
  const res = await client.callTool("read_page", {});
  assert.equal(res.status, "error");
  assert.equal(res.reason, "dom-not-implemented-in-beta");
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("transport: delayed verdict relays terminally (blocking hold)", async () => {
  const { daemon, ext } = await boot();
  const client = createRuntimeClient({ url: `ws://127.0.0.1:${daemon.ports.wsPort}`, storage: mem() });
  await client.connect();
  await client.pair(daemon.getPairingCode().code);
  const t0 = Date.now();
  const verdict = await client.callTool("click", { ref: "el_1" });
  assert.ok(Date.now() - t0 >= 1200, "must hold the call open for the verdict");
  assert.equal(verdict.status, "denied");
  client.disconnect();
  await ext.close();
  await daemon.close();
});

test("transport: daemon death settles in-flight calls, flips status, never hangs", async () => {
  const { daemon, ext } = await boot();
  const client = createRuntimeClient({ url: `ws://127.0.0.1:${daemon.ports.wsPort}`, storage: mem() });
  await client.connect();
  await client.pair(daemon.getPairingCode().code);
  const doomed = client.callTool("click", { ref: "el_2" });
  await new Promise((r) => setTimeout(r, 300));
  await daemon.close();
  const settled = await Promise.race([
    doomed.then(
      (v) => ({ settled: true, status: v && v.status }),
      (e) => ({ settled: true, rejected: true }),
    ),
    new Promise((r) => setTimeout(() => r({ settled: false }), 5000)),
  ]);
  assert.equal(settled.settled, true);
  let flipped = false;
  for (let i = 0; i < 60 && !flipped; i++) {
    flipped = client.getStatus().connected === false;
    if (!flipped) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(flipped, true);
  client.disconnect();
  await ext.close();
});
