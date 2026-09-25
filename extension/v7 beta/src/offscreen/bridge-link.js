/**
 * Bridge Link — WebSocket client to @perscope/bridge (runs in OFFSCREEN).
 *
 * Why offscreen and not the service worker: MV3 service workers suspend
 * after ~30s idle and kill any socket. The offscreen document already
 * exists as the always-on host, so it owns the connection instead; the
 * service worker only relays status/pairing messages and sets the badge.
 *
 * Wire contract (must match bridge/src/ws-server.js):
 *   pair:    {type:"pair", code} -> {type:"paired", clientId, token}
 *   hello:   {type:"hello", auth} -> {type:"welcome", clientId}
 *   failure: {type:"pair-error", reason}
 *   tools:   {id, tool, params, auth} <-> {id, status, auth, ...rest}
 *            (auth is attached by this module; the bridge strips it
 *            before relaying to agents, so the token never leaks.)
 *
 * Human Mode never depends on this module: every failure path logs and
 * degrades to "bridge not running". Nothing here throws into the pipeline.
 */

export const BRIDGE_WS_URL = "ws://127.0.0.1:7331";
export const TOKEN_KEY = "perscope.bridgeToken";
export const CLIENT_ID_KEY = "perscope.bridgeClientId";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HANDSHAKE_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadStoredAuth() {
  try {
    const stored = await chrome.storage.local.get([TOKEN_KEY, CLIENT_ID_KEY]);
    return { token: stored[TOKEN_KEY] || null, clientId: stored[CLIENT_ID_KEY] || null };
  } catch {
    return { token: null, clientId: null };
  }
}

/**
 * @param {object} hooks
 * @param {(req:{id:string,tool:string,params:object}) => Promise<object>} hooks.onToolRequest
 *   Resolve with the result payload (status + fields, WITHOUT id/auth —
 *   those are attached here). Never reject with secrets inside.
 * @param {(status:BridgeStatus) => void} [hooks.onStatusChange]
 */
export function startBridgeLink({ onToolRequest, onStatusChange } = {}) {
  const state = {
    ws: null,
    connected: false,
    paired: false,
    token: null,
    clientId: null,
    stopped: false,
    reconnectDelay: RECONNECT_BASE_MS,
    pairingWaiters: new Map(), // nonce -> {resolve, reject, timer}
  };

  const status = () => ({
    connected: state.connected,
    paired: state.paired,
    bridgeReachable: state.connected,
  });
  const emit = () => {
    try {
      onStatusChange?.(status());
    } catch {
      // Status listeners must never break the link.
    }
  };

  function send(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  async function helloOrUnpaired() {
    const stored = await loadStoredAuth();
    if (stored.token) {
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), HANDSHAKE_TIMEOUT_MS);
        const onMsg = (event) => {
          let msg;
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (msg.type === "welcome") {
            clearTimeout(timer);
            state.ws?.removeEventListener("message", onMsg);
            state.token = stored.token;
            state.clientId = msg.clientId || stored.clientId;
            resolve(true);
          } else if (msg.status === "error") {
            clearTimeout(timer);
            state.ws?.removeEventListener("message", onMsg);
            resolve(false);
          }
        };
        state.ws.addEventListener("message", onMsg);
        send({ type: "hello", auth: stored.token });
      });
      if (ok) {
        state.paired = true;
        emit();
        return;
      }
      // Stored token rejected (e.g. bridge data wiped): forget it, await pairing.
      try {
        await chrome.storage.local.remove([TOKEN_KEY, CLIENT_ID_KEY]);
      } catch {
        // Best effort.
      }
    }
    state.paired = false;
    emit();
  }

  function onSocketMessage(event) {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    // Pairing handshake replies are routed to submitPairingCode waiters.
    if (msg.type === "paired" || msg.type === "pair-error") {
      const waiter = state.pairingWaiters.get("pair");
      if (waiter) {
        clearTimeout(waiter.timer);
        state.pairingWaiters.delete("pair");
        waiter.resolve(msg);
      }
      return;
    }
    // Tool requests from the bridge (only valid once authenticated).
    if (msg && typeof msg.id === "string" && typeof msg.tool === "string") {
      if (!state.paired) return;
      const params = msg.params && typeof msg.params === "object" ? msg.params : {};
      Promise.resolve()
        .then(() => onToolRequest({ id: msg.id, tool: msg.tool, params }))
        .then(
          (result) => send({ id: msg.id, auth: state.token, ...(result || { status: "error", reason: "empty-result" }) }),
          (err) => send({ id: msg.id, auth: state.token, status: "error", reason: err?.message || "handler-failed" }),
        );
    }
  }

  async function connectLoop() {
    while (!state.stopped) {
      try {
        await new Promise((resolve, reject) => {
          let ws;
          try {
            ws = new WebSocket(BRIDGE_WS_URL);
          } catch (err) {
            reject(err);
            return;
          }
          const openTimer = setTimeout(() => {
            try {
              ws.close();
            } catch {
              // Best effort.
            }
            reject(new Error("connect-timeout"));
          }, HANDSHAKE_TIMEOUT_MS);
          ws.addEventListener("open", () => {
            clearTimeout(openTimer);
            resolve(ws);
          });
          ws.addEventListener("error", () => {
            clearTimeout(openTimer);
            reject(new Error("connect-failed"));
          });
        }).then(async (ws) => {
          state.ws = ws;
          state.connected = true;
          state.reconnectDelay = RECONNECT_BASE_MS;
          ws.addEventListener("message", onSocketMessage);
          ws.addEventListener("close", () => {
            state.connected = false;
            state.paired = false;
            emit();
          });
          ws.addEventListener("error", () => {
            // Per-socket noise; the close handler drives reconnect.
          });
          emit();
          await helloOrUnpaired();
          // Park here until the socket closes, then loop to reconnect.
          await new Promise((resolve) => {
            ws.addEventListener("close", resolve, { once: true });
          });
        });
      } catch {
        // Bridge not running (or connect timeout): back off silently.
        // Human Mode works entirely without the bridge.
      }
      state.connected = false;
      state.paired = false;
      state.ws = null;
      emit();
      if (state.stopped) break;
      const jitter = Math.floor(Math.random() * 500);
      await sleep(state.reconnectDelay + jitter);
      state.reconnectDelay = Math.min(state.reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  }

  /**
   * Submit a user-typed pairing code. Resolves {ok:true} or
   * {ok:false, reason}. Requires a live socket (else "no-connection").
   */
  function submitPairingCode(code) {
    return new Promise((resolve) => {
      if (!state.connected) {
        resolve({ ok: false, reason: "no-connection" });
        return;
      }
      const timer = setTimeout(() => {
        state.pairingWaiters.delete("pair");
        resolve({ ok: false, reason: "timeout" });
      }, HANDSHAKE_TIMEOUT_MS);
      state.pairingWaiters.set("pair", {
        timer,
        resolve: async (msg) => {
          if (msg.type === "paired" && msg.token) {
            state.token = msg.token;
            state.clientId = msg.clientId || null;
            state.paired = true;
            try {
              await chrome.storage.local.set({ [TOKEN_KEY]: msg.token, [CLIENT_ID_KEY]: state.clientId });
            } catch {
              // Token stays in memory; persistence is best-effort.
            }
            emit();
            resolve({ ok: true });
          } else {
            resolve({ ok: false, reason: msg.reason || "pair-failed" });
          }
        },
      });
      if (!send({ type: "pair", code: String(code).trim() })) {
        clearTimeout(timer);
        state.pairingWaiters.delete("pair");
        resolve({ ok: false, reason: "no-connection" });
      }
    });
  }

  connectLoop();
  return { getStatus: status, submitPairingCode };
}
