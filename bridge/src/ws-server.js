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
 *   Agent -> bridge      { "type": "pair", "code": "123456", "role": "agent" }
 *   Bridge -> client    { "type": "paired", "clientId": "ext-…"|"agent-…", "token": "…" }
 *   Client -> bridge    { "type": "hello", "auth": "<token>", "role"?: "agent" }
 *     (role defaults to "extension" when absent, preserving pre-role clients;
 *      a declared role must match the stored record or the socket is closed)
 *   Bridge -> client    { "type": "welcome", "clientId": "…" }
 *   Bridge -> extension { "id": "…", "tool": "<name>", "params": {...} }
 *   Extension -> bridge { "id": "…", "status": "ok"|"denied"|"timeout"|"error",
 *                           "auth": "<token>", ...rest }
 *   Agent -> bridge     { "id": "<agent-id>", "tool": "<name>", "params": {...},
 *                           "auth": "<token>" }
 *   Bridge -> agent     { "id": "<agent-id>", "status": "ok"|"denied"|"timeout"|"error",
 *                           ...rest }
 *     (agent ids are remapped to internal UUIDs on the extension leg, so
 *      concurrent agents can never collide; the agent always sees its own id)
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
    this.sockets = new Map(); // clientId -> { ws, token, role, lastActive }
    this.pending = new Map(); // internalId -> { resolve, timer }
    this.agentInflight = new Map(); // `${clientId}:${agentId}` -> internalId
    this.pairing = generatePairingCode();
    this.pairedClients = loadPairedClients(dir);
  }

  /** Pre-role records (and ext- ids) count as the extension. */
  static roleOf(record) {
    return record && record.role === "agent" ? "agent" : "extension";
  }

  getPairingCode() {
    // Lazily rotate on natural expiry so the dashboard/stdout always show a
    // usable code without a daemon restart (each code stays single-use,
    // 10-minute, 5-strikes — rotation changes availability, not strength).
    if (!this.pairing.consumed && Date.now() > this.pairing.expiresAt) {
      this.pairing = generatePairingCode();
      this.emit("pairing-rotated", this.getPairingCode());
    }
    return this.pairing.consumed || Date.now() > this.pairing.expiresAt
      ? { code: null, expiresAt: this.pairing.expiresAt, pairingNeeded: this.authenticatedCount() === 0 }
      : { code: this.pairing.code, expiresAt: this.pairing.expiresAt, pairingNeeded: true };
  }

  authenticatedCount(role) {
    let n = 0;
    for (const s of this.sockets.values()) {
      if (!s.authenticated) continue;
      if (role && s.role !== role) continue;
      n += 1;
    }
    return n;
  }

  getStatus() {
    return {
      extensionConnected: this.authenticatedCount("extension") > 0,
      pairedClients: this.pairedClients.clients.length,
      // Tokens never leave the daemon: dashboard/health see ids + roles only.
      clients: this.pairedClients.clients.map((c) => ({
        clientId: c.clientId,
        role: ExtensionBridge.roleOf(c),
        pairedAt: c.pairedAt || null,
      })),
      pairingNeeded: this.authenticatedCount("extension") === 0 && (this.pairing.consumed || Date.now() > this.pairing.expiresAt),
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
    const state = { ws, authenticated: false, clientId: null, token: null, role: null };
    ws.on("message", (data) => this.#onMessage(state, data));
    ws.on("close", () => {
      if (state.clientId && this.sockets.get(state.clientId)?.ws === ws) {
        this.sockets.delete(state.clientId);
      }
      // Sweep in-flight agent calls for a dead socket so keys never linger
      // past close (pending extension replies then resolve to no-ops).
      if (state.clientId) {
        for (const [key, internalId] of this.agentInflight) {
          if (key.startsWith(`${state.clientId}:`)) {
            this.agentInflight.delete(key);
            const entry = this.pending.get(internalId);
            if (entry) {
              this.pending.delete(internalId);
              clearTimeout(entry.timer);
            }
          }
        }
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
      // Response to a bridge-initiated tool call: correlate by INTERNAL id.
      // Works for both the MCP leg and agent-leg remapped calls.
      const entry = this.pending.get(msg.id);
      if (!entry) return; // Late/duplicate response after timeout; ignore.
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      const { auth: _auth, ...relay } = msg;
      entry.resolve(relay);
      return;
    }

    if (typeof msg.id === "string" && typeof msg.tool === "string") {
      if (state.role === "agent") {
        this.#handleAgentRequest(state, msg);
        return;
      }
      // Extension-initiated request (reserved for future capture events).
      // The bridge relays; it has no handler, so answer honestly.
      const { auth: _auth, ...rest } = msg;
      void rest;
      this.#send(state.ws, { id: msg.id, status: "error", reason: "no-extension-request-handler" });
      return;
    }

    this.#rejectAndClose(state, null, "invalid-message");
  }

  /**
   * Agent-leg tool call (D1/D2): validate, guard duplicate in-flight ids,
   * remap to an internal UUID for the extension leg, and resolve back to
   * the requesting socket with the AGENT's id. The agent always sees its
   * own id; concurrent agents can never collide.
   */
  #handleAgentRequest(state, msg) {
    if (typeof msg.tool !== "string" || !msg.tool) {
      this.#send(state.ws, { id: msg.id, status: "error", reason: "invalid-tool" });
      return;
    }
    const inflightKey = `${state.clientId}:${msg.id}`;
    if (this.agentInflight.has(inflightKey)) {
      this.#send(state.ws, { id: msg.id, status: "error", reason: "duplicate-id" });
      return;
    }
    const target = this.#targetSocket();
    if (!target) {
      this.#send(state.ws, { id: msg.id, status: "error", reason: "no paired extension connected" });
      return;
    }
    const internalId = crypto.randomUUID();
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    const finish = (extRes) => {
      this.agentInflight.delete(inflightKey);
      const { auth: _auth, id: _iid, ...rest } = extRes;
      this.#send(state.ws, { id: msg.id, ...rest });
    };
    const timer = setTimeout(() => {
      this.pending.delete(internalId);
      finish({ status: "timeout", reason: "extension-timeout" });
    }, this.toolTimeoutMs);
    if (timer.unref) timer.unref();
    this.agentInflight.set(inflightKey, internalId);
    this.pending.set(internalId, {
      resolve: finish,
      timer,
    });
    this.#send(target.ws, { id: internalId, tool: msg.tool, params });
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
    const clientId =
      (msg.role === "agent" ? "agent-" : "ext-") + crypto.randomBytes(4).toString("hex");
    const token = crypto.randomBytes(32).toString("base64url");
    const role = msg.role === "agent" ? "agent" : "extension";
    this.pairedClients = addPairedClient(this.dir, { clientId, token, role });
    state.authenticated = true;
    state.clientId = clientId;
    state.token = token;
    state.role = role;
    state.lastActive = Date.now();
    this.sockets.set(clientId, state);
    this.#send(state.ws, { type: "paired", clientId, token });
    // A consumed code can never pair again, so mint its replacement now:
    // the dashboard keeps showing a live code for the next client.
    this.pairing = generatePairingCode();
    this.emit("paired", { clientId, role });
    this.emit("pairing-rotated", this.getPairingCode());
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
    // Role declared at hello must match the stored record. Absent role
    // means "extension", preserving pre-role clients (incl. the extension).
    const declared = msg.role === "agent" ? "agent" : "extension";
    if (ExtensionBridge.roleOf(holder) !== declared) {
      this.#rejectAndClose(state, null, "unauthorized");
      return;
    }
    state.authenticated = true;
    state.clientId = holder.clientId;
    state.token = holder.token;
    state.role = ExtensionBridge.roleOf(holder);
    state.lastActive = Date.now();
    this.sockets.set(holder.clientId, state);
    this.#send(state.ws, { type: "welcome", clientId: holder.clientId });
  }

  #targetSocket() {
    // Extension sockets ONLY — agent sockets must never receive
    // extension-bound tool calls. Most-recently-active wins (covers
    // reconnects where the old socket hasn't timed out yet).
    let best = null;
    for (const s of this.sockets.values()) {
      if (!s.authenticated || s.role !== "extension" || s.ws.readyState !== s.ws.OPEN) continue;
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
    this.agentInflight.clear();
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
