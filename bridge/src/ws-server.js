import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import {
  addPairedClient,
  findClientByToken,
  generatePairingCode,
  loadPairedClients,
  verifyPairingCode,
} from "./pairing.js";

/**
 * Extension-facing WebSocket server (binds 127.0.0.1 only).
 *
 * Wire protocol (all frames are JSON text):
 *   Extension -> bridge  { "type": "pair", "code": "123456" }
 *   Bridge -> extension  { "type": "paired", "clientId": "ext-…", "token": "…" }
 *   Extension -> bridge  { "type": "hello", "auth": "<token>" }   (reconnects)
 *   Bridge -> extension  { "type": "welcome", "clientId": "ext-…" }
 *   Bridge -> extension  { "id": "…", "tool": "<name>", "params": {...} }
 *   Extension -> bridge  { "id": "…", "status": "ok"|"denied"|"timeout"|"error",
 *                           "auth": "<token>", ...rest }
 *
 * Per-message `auth` is REQUIRED on every extension frame after the initial
 * pair/hello handshake; anything missing/invalid auth is answered with an
 * error and the socket is closed. The `auth` field is stripped before a
 * response is relayed to agents, so the token never leaks to MCP clients.
 *
 * This class holds NO safety logic: it relays {id, tool, params} to the
 * extension and correlates {id, …} responses. isDestructive() and all
 * Approve/Deny behavior live in the extension.
 */
export class ExtensionBridge extends EventEmitter {
  constructor({ port = 7331, host = "127.0.0.1", dir, toolTimeoutMs = 60_000 } = {}) {
    super();
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      throw new Error(`refusing to bind extension WS server to non-localhost host: ${host}`);
    }
    this.host = "127.0.0.1";
    this.port = port;
    this.dir = dir;
    this.toolTimeoutMs = toolTimeoutMs;
    this.wss = null;
    this.sockets = new Map(); // clientId -> { ws, token, lastActive }
    this.pending = new Map(); // id -> { resolve, timer }
    this.pairing = generatePairingCode();
    this.pairedClients = loadPairedClients(dir);
  }

  getPairingCode() {
    return this.pairing.consumed || Date.now() > this.pairing.expiresAt
      ? { code: null, expiresAt: this.pairing.expiresAt, pairingNeeded: this.authenticatedCount() === 0 }
      : { code: this.pairing.code, expiresAt: this.pairing.expiresAt, pairingNeeded: true };
  }

  authenticatedCount() {
    let n = 0;
    for (const s of this.sockets.values()) if (s.authenticated) n += 1;
    return n;
  }

  getStatus() {
    return {
      extensionConnected: this.authenticatedCount() > 0,
      pairedClients: this.pairedClients.clients.length,
      pairingNeeded: this.authenticatedCount() === 0 && (this.pairing.consumed || Date.now() > this.pairing.expiresAt),
      pairingLocked: Date.now() < this.pairing.lockedUntil,
    };
  }

  async start() {
    this.wss = new WebSocketServer({ host: this.host, port: this.port, maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      this.wss.on("listening", resolve);
      this.wss.on("error", reject);
    });
    this.wss.on("connection", (ws) => this.#onConnection(ws));
    return { wsPort: this.wss.address().port };
  }

  #onConnection(ws) {
    const state = { ws, authenticated: false, clientId: null, token: null };
    ws.on("message", (data) => this.#onMessage(state, data));
    ws.on("close", () => {
      if (state.clientId && this.sockets.get(state.clientId)?.ws === ws) {
        this.sockets.delete(state.clientId);
      }
    });
    ws.on("error", () => {
      // Socket errors are per-connection noise; the server keeps running.
    });
  }

  #send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  #rejectAndClose(state, id, reason) {
    this.#send(state.ws, id ? { id, status: "error", reason } : { status: "error", reason });
    try {
      state.ws.close(4401, reason);
    } catch {
      // Best effort.
    }
  }

  #onMessage(state, data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      this.#rejectAndClose(state, null, "invalid-json");
      return;
    }
    if (!msg || typeof msg !== "object") {
      this.#rejectAndClose(state, null, "invalid-message");
      return;
    }

    // --- Handshake frames (no auth yet) ---------------------------------
    if (msg.type === "pair") {
      this.#handlePair(state, msg);
      return;
    }
    if (msg.type === "hello") {
      this.#handleHello(state, msg);
      return;
    }

    // --- Everything else requires a valid per-message token -------------
    const presented = typeof msg.auth === "string" ? msg.auth : null;
    const holder = presented ? findClientByToken(this.pairedClients, presented) : null;
    if (!state.authenticated || !holder || holder.token !== state.token) {
      this.#rejectAndClose(state, typeof msg.id === "string" ? msg.id : null, "unauthorized");
      return;
    }
    state.lastActive = Date.now();

    if (typeof msg.id === "string" && typeof msg.tool !== "string") {
      // Response to a bridge-initiated tool call: correlate by id.
      const entry = this.pending.get(msg.id);
      if (!entry) return; // Late/duplicate response after timeout; ignore.
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      const { auth: _auth, ...relay } = msg;
      entry.resolve(relay);
      return;
    }

    if (typeof msg.id === "string" && typeof msg.tool === "string") {
      // Extension-initiated request (reserved for future capture events).
      // The bridge relays; it has no handler, so answer honestly.
      const { auth: _auth, ...rest } = msg;
      void rest;
      this.#send(state.ws, { id: msg.id, status: "error", reason: "no-extension-request-handler" });
      return;
    }

    this.#rejectAndClose(state, null, "invalid-message");
  }

  #handlePair(state, msg) {
    if (state.authenticated) {
      this.#send(state.ws, { status: "error", reason: "already-paired" });
      return;
    }
    if (typeof msg.code !== "string") {
      this.#send(state.ws, { type: "pair-error", reason: "missing-code" });
      return;
    }
    const result = verifyPairingCode(this.pairing, msg.code);
    if (!result.ok) {
      if (result.reason === "locked" || result.reason === "expired") {
        // Rotate to a fresh code so a lockout/expiry never dead-ends pairing;
        // the new code is shown on the dashboard/stdout.
        this.pairing = generatePairingCode();
        this.emit("pairing-rotated", this.getPairingCode());
      }
      this.#send(state.ws, { type: "pair-error", reason: result.reason });
      return;
    }
    const clientId = `ext-${crypto.randomBytes(4).toString("hex")}`;
    const token = crypto.randomBytes(32).toString("base64url");
    this.pairedClients = addPairedClient(this.dir, { clientId, token });
    state.authenticated = true;
    state.clientId = clientId;
    state.token = token;
    state.lastActive = Date.now();
    this.sockets.set(clientId, state);
    this.#send(state.ws, { type: "paired", clientId, token });
    this.emit("paired", { clientId });
  }

  #handleHello(state, msg) {
    if (typeof msg.auth !== "string") {
      this.#rejectAndClose(state, null, "unauthorized");
      return;
    }
    const holder = findClientByToken(this.pairedClients, msg.auth);
    if (!holder) {
      this.#rejectAndClose(state, null, "unauthorized");
      return;
    }
    state.authenticated = true;
    state.clientId = holder.clientId;
    state.token = holder.token;
    state.lastActive = Date.now();
    this.sockets.set(holder.clientId, state);
    this.#send(state.ws, { type: "welcome", clientId: holder.clientId });
  }

  #targetSocket() {
    // Most recently active authenticated socket wins (covers reconnects
    // where the old socket hasn't timed out yet).
    let best = null;
    for (const s of this.sockets.values()) {
      if (!s.authenticated || s.ws.readyState !== s.ws.OPEN) continue;
      if (!best || (s.lastActive ?? 0) > (best.lastActive ?? 0)) best = s;
    }
    return best;
  }

  /**
   * Relay one tool call to the paired extension and await its correlated
   * response (blocking call — no polling, no push). Resolves with the
   * extension's response object, or with { status: "timeout" } if nothing
   * comes back within timeoutMs. Rejects only when there is no paired
   * extension to ask at all.
   */
  callTool(tool, params, timeoutMs = this.toolTimeoutMs) {
    const target = this.#targetSocket();
    if (!target) {
      return Promise.reject(new Error("no paired extension connected"));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, status: "timeout", reason: "extension-timeout" });
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, timer });
      this.#send(target.ws, { id, tool, params: params ?? {} });
    });
  }

  async close() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ status: "error", reason: "bridge-shutdown" });
    }
    this.pending.clear();
    if (this.wss) {
      for (const client of this.wss.clients) {
        try {
          client.terminate();
        } catch {
          // Best effort.
        }
      }
      await new Promise((resolve) => this.wss.close(resolve));
      this.wss = null;
    }
    this.sockets.clear();
  }
}
