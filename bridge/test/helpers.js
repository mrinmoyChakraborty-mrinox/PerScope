import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { runDaemon } from "../src/daemon.js";

export async function startTestDaemon(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "perscope-bridge-test-"));
  const daemon = await runDaemon({ dir, wsPort: 0, httpPort: 0, relayPort: 0, toolTimeoutMs: 5000, ...overrides });
  return { dir, daemon, ports: daemon.ports };
}

/**
 * Fake PerScope extension: pairs over WS and answers tool calls with
 * canned responses. Keeps the bridge honest — the bridge must relay
 * opaquely, so whatever this mock returns must arrive unchanged.
 */
export class MockExtension {
  constructor(wsPort) {
    this.wsPort = wsPort;
    this.handlers = new Map();
    this.received = [];
    this.token = null;
    this.clientId = null;
    this.ws = null;
  }

  onTool(tool, handler) {
    this.handlers.set(tool, handler);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.wsPort}`);
      const timer = setTimeout(() => reject(new Error("mock extension connect timeout")), 5000);
      ws.on("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        ws.on("message", (data) => this.#dispatch(data).catch(() => {}));
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async #dispatch(data) {
    const msg = JSON.parse(String(data));
    if (msg.type === "paired") {
      this.token = msg.token;
      this.clientId = msg.clientId;
      return;
    }
    if (msg.type === "welcome" || msg.type === "pair-error") return;
    if (msg.id && msg.tool) {
      this.received.push(msg);
      const handler = this.handlers.get(msg.tool);
      const result = handler ? await handler(msg.params ?? {}) : { status: "error", reason: `no-mock-for-${msg.tool}` };
      this.ws.send(JSON.stringify({ id: msg.id, auth: this.token, ...result }));
    }
  }

  pair(code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pair timeout")), 5000);
      const onMsg = (data) => {
        const msg = JSON.parse(String(data));
        if (msg.type === "paired") {
          clearTimeout(timer);
          this.ws.off("message", onMsg);
          this.token = msg.token;
          this.clientId = msg.clientId;
          resolve(msg);
        } else if (msg.type === "pair-error") {
          clearTimeout(timer);
          this.ws.off("message", onMsg);
          reject(new Error(`pair-error: ${msg.reason}`));
        }
      };
      this.ws.on("message", onMsg);
      this.ws.send(JSON.stringify({ type: "pair", code }));
    });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.ws) return resolve();
      this.ws.on("close", resolve);
      this.ws.close();
      setTimeout(resolve, 1000).unref?.();
    });
  }
}
