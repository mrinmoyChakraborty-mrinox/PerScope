import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MockExtension, startTestDaemon } from "./helpers.js";
import { runDaemon } from "../src/daemon.js";

const CANNED = { status: "ok", marker: "from-extension" };

/** Raw agent socket with a message log. */
async function openAgent(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const received = [];
  ws.on("message", (data) => {
    try {
      received.push(JSON.parse(String(data)));
    } catch {
      // Ignore non-JSON (never expected).
    }
  });
  return {
    ws,
    received,
    send: (obj) => ws.send(JSON.stringify(obj)),
    waitFor: (pred, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          const hit = received.find(pred);
          if (hit) return resolve(hit);
          if (Date.now() > deadline) return reject(new Error("agent wait timeout"));
          setTimeout(poll, 25);
        };
        poll();
      }),
    close: () =>
      new Promise((resolve) => {
        ws.on("close", resolve);
        ws.close();
        setTimeout(resolve, 1000).unref?.();
      }),
  };
}

function waitClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), timeoutMs);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

test("dashboard keeps a live code: second pairing needs no restart", async () => {
  const { daemon, ports } = await startTestDaemon();
  const firstCode = daemon.getPairingCode().code;
  assert.ok(firstCode);

  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  await ext.pair(firstCode);
  assert.ok(ext.clientId.startsWith("ext-"));

  // Consumed code is replaced immediately: dashboard-worthy fresh code.
  const secondCode = daemon.getPairingCode().code;
  assert.ok(secondCode);
  assert.notEqual(secondCode, firstCode);

  const agent = new MockExtension(ports.wsPort);
  await agent.connect();
  await agent.pair(secondCode, "agent");
  assert.ok(agent.clientId.startsWith("agent-"));

  const status = daemon.getStatus();
  assert.equal(status.pairedClients, 2);
  assert.deepEqual(
    status.clients.map((c) => c.role).sort(),
    ["agent", "extension"],
  );
  assert.ok(!JSON.stringify(status).includes(ext.token), "tokens stay out of status");

  await agent.close();
  await ext.close();
  await daemon.close();
});

test("agent request routes to extension with remapped id; agent sees own id", async () => {
  const { dir, daemon, ports } = await startTestDaemon();
  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  ext.onTool("capture_tab", async () => ({ ...CANNED }));
  await ext.pair(daemon.getPairingCode().code);
  const extToken = ext.token;
  await daemon.close();

  // Fresh code for the second pairing (single-use codes by design).
  const daemon2 = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000 });
  const ext2 = new MockExtension(daemon2.ports.wsPort);
  await ext2.connect();
  ext2.onTool("capture_tab", async () => ({ ...CANNED }));
  await ext2.hello(extToken);

  const agent = await openAgent(daemon2.ports.wsPort);
  const paired = await new Promise((resolve, reject) => {
    agent
      .waitFor((m) => m.type === "paired" || m.type === "pair-error")
      .then((m) => (m.type === "paired" ? resolve(m) : reject(new Error(m.reason))));
    agent.send({ type: "pair", code: daemon2.getPairingCode().code, role: "agent" });
  });
  const agentId = "req_agent_1";
  agent.send({ id: agentId, tool: "capture_tab", params: {}, auth: paired.token });
  const reply = await agent.waitFor((m) => m.id === agentId);

  assert.equal(reply.status, "ok");
  assert.equal(reply.marker, CANNED.marker);
  assert.ok(!("auth" in reply), "token must never leak to agents");
  assert.equal(ext2.received.length, 1);
  assert.notEqual(ext2.received[0].id, agentId, "extension leg must use an internal id");
  assert.equal(ext2.received[0].tool, "capture_tab");

  await agent.close();
  await ext.close();
  await ext2.close();
  await daemon2.close();
});

test("duplicate in-flight id is rejected; extension sees one request", async () => {
  const { dir, daemon, ports } = await startTestDaemon();
  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  let calls = 0;
  ext.onTool("click", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { status: "ok" };
  });
  await ext.pair(daemon.getPairingCode().code);
  const extToken = ext.token;
  await daemon.close();

  const daemon2 = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000 });
  const ext2 = new MockExtension(daemon2.ports.wsPort);
  await ext2.connect();
  ext2.onTool("click", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { status: "ok" };
  });
  await ext2.hello(extToken);

  const agent = await openAgent(daemon2.ports.wsPort);
  const pairedP = agent.waitFor((m) => m.type === "paired");
  agent.send({ type: "pair", code: daemon2.getPairingCode().code, role: "agent" });
  const paired = await pairedP;
  agent.send({ id: "dup", tool: "click", params: { ref: "el_1" }, auth: paired.token });
  agent.send({ id: "dup", tool: "click", params: { ref: "el_1" }, auth: paired.token });
  const dupErr = await agent.waitFor((m) => m.id === "dup" && m.status === "error");
  assert.equal(dupErr.reason, "duplicate-id");
  const okReply = await agent.waitFor((m) => m.id === "dup" && m.status === "ok");
  assert.ok(okReply);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(calls, 1);

  await agent.close();
  await ext.close();
  await ext2.close();
  await daemon2.close();
});

test("two agents may reuse one id; responses stay separate", async () => {
  const { dir, daemon, ports } = await startTestDaemon();
  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  await ext.pair(daemon.getPairingCode().code);
  const extToken = ext.token;
  await ext.close();
  await daemon.close();

  // Second boot: fresh code, persisted clients. Extension + agent 1 attach.
  const daemon2 = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000 });
  const ext2 = new MockExtension(daemon2.ports.wsPort);
  await ext2.connect();
  ext2.onTool("read_page", async (params) => ({ status: "ok", echo: params?.who }));
  await ext2.hello(extToken);
  const a1 = await openAgent(daemon2.ports.wsPort);
  const p1 = a1.waitFor((m) => m.type === "paired");
  a1.send({ type: "pair", code: daemon2.getPairingCode().code, role: "agent" });
  const cp1 = await p1;
  await a1.close();
  await ext2.close();
  await daemon2.close();

  // Third boot: both agents reattach (hello with persisted tokens), then
  // agent 2 pairs fresh. All three live simultaneously.
  const daemon3 = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000 });
  const ext3 = new MockExtension(daemon3.ports.wsPort);
  await ext3.connect();
  ext3.onTool("read_page", async (params) => ({ status: "ok", echo: params?.who }));
  await ext3.hello(extToken);
  const b1 = await openAgent(daemon3.ports.wsPort);
  b1.send({ type: "hello", auth: cp1.token, role: "agent" });
  await b1.waitFor((m) => m.type === "welcome");
  const b2 = await openAgent(daemon3.ports.wsPort);
  const p2 = b2.waitFor((m) => m.type === "paired");
  b2.send({ type: "pair", code: daemon3.getPairingCode().code, role: "agent" });
  const cp2 = await p2;

  // Same request id, concurrently, from both agents.
  b1.send({ id: "same", tool: "read_page", params: { who: "one" }, auth: cp1.token });
  b2.send({ id: "same", tool: "read_page", params: { who: "two" }, auth: cp2.token });
  const rep1 = await b1.waitFor((m) => m.id === "same");
  const rep2 = await b2.waitFor((m) => m.id === "same");
  assert.equal(rep1.echo, "one");
  assert.equal(rep2.echo, "two");
  assert.equal(ext3.received.length, 2);
  assert.notEqual(ext3.received[0].id, ext3.received[1].id);
  assert.ok(!("auth" in rep1) && !("auth" in rep2));

  await b1.close();
  await b2.close();
  await ext.close();
  await ext2.close();
  await ext3.close();
  await daemon3.close();
});

test("role mismatch on hello is rejected and closed", async () => {
  const { daemon, ports } = await startTestDaemon();
  const agent = new MockExtension(ports.wsPort);
  await agent.connect();
  await agent.pair(daemon.getPairingCode().code, "agent");
  const token = agent.token;
  await agent.close();

  const ws = new WebSocket(`ws://127.0.0.1:${ports.wsPort}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", auth: token }));
  const reply = await new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
  assert.equal(reply.reason, "unauthorized");
  assert.equal(await waitClose(ws), 4401);
  await daemon.close();
});

test("extension-bound calls never go to agent sockets", async () => {
  const { dir, daemon, ports } = await startTestDaemon();
  const ext = new MockExtension(ports.wsPort);
  await ext.connect();
  ext.onTool("capture_tab", async () => ({ status: "ok", via: "mcp-leg" }));
  await ext.pair(daemon.getPairingCode().code);
  const extToken = ext.token;
  await daemon.close();

  const daemon2 = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000 });
  const ext2 = new MockExtension(daemon2.ports.wsPort);
  await ext2.connect();
  ext2.onTool("capture_tab", async () => ({ status: "ok", via: "mcp-leg" }));
  await ext2.hello(extToken);

  // Agent socket connects + pairs AFTER the extension's last activity,
  // making it the most-recently-active socket by the old (broken) rule.
  const agent = await openAgent(daemon2.ports.wsPort);
  const pairedP = agent.waitFor((m) => m.type === "paired");
  agent.send({ type: "pair", code: daemon2.getPairingCode().code, role: "agent" });
  await pairedP;

  const client = new Client({ name: "mux-mcp", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${daemon2.ports.httpPort}/mcp`)),
  );
  const result = await client.callTool({ name: "capture_tab", arguments: {} });
  await client.close();
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.via, "mcp-leg");
  assert.equal(ext2.received.length, 1, "extension must receive the call");

  await new Promise((resolve) => setTimeout(resolve, 300));
  const toolFrames = agent.received.filter((m) => typeof m.tool === "string");
  assert.equal(toolFrames.length, 0, "agent socket must never receive tool calls");

  await agent.close();
  await ext.close();
  await ext2.close();
  await daemon2.close();
});
