import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { startTestDaemon } from "./helpers.js";

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
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

test("unauthenticated tool frame is rejected and the socket closed", async () => {
  const { daemon, ports } = await startTestDaemon();
  const ws = await connect(ports.wsPort);
  ws.send(JSON.stringify({ id: "x1", tool: "click", params: { ref: "el_1" } }));
  const reply = await nextMessage(ws);
  assert.equal(reply.status, "error");
  assert.equal(reply.reason, "unauthorized");
  const code = await waitClose(ws);
  assert.equal(code, 4401);
  await daemon.close();
});

test("wrong pairing code fails; right code pairs; token re-auth works", async () => {
  const { daemon, ports } = await startTestDaemon();
  const ws = await connect(ports.wsPort);
  ws.send(JSON.stringify({ type: "pair", code: "000000" }));
  const err = await nextMessage(ws);
  assert.equal(err.type, "pair-error");

  const code = daemon.getPairingCode().code;
  ws.send(JSON.stringify({ type: "pair", code }));
  const paired = await nextMessage(ws);
  assert.equal(paired.type, "paired");
  assert.ok(paired.token);
  ws.close();

  // Reconnect with the stored token.
  const ws2 = await connect(ports.wsPort);
  ws2.send(JSON.stringify({ type: "hello", auth: paired.token }));
  const welcome = await nextMessage(ws2);
  assert.deepEqual(welcome, { type: "welcome", clientId: paired.clientId });

  // A forged token on an authenticated-shape message is rejected + closed.
  ws2.send(JSON.stringify({ id: "x2", tool: "click", params: {}, auth: "forged" }));
  const rej = await nextMessage(ws2);
  assert.equal(rej.reason, "unauthorized");
  await waitClose(ws2);
  await daemon.close();
});
