/* =========================================================
   PERSCOPE PLAYGROUND — RUNTIME CLIENT (transport only)
   =========================================================
   Speaks the real bridge WS protocol as an agent client
   (bridge/src/ws-server.js is the contract — never deviate here):

     pair:  {type:"pair", code, role:"agent"} -> {type:"paired", clientId, token}
     hello: {type:"hello", auth, role:"agent"} -> {type:"welcome", clientId}
     tools: {id, tool, params, auth} -> {id, status, ...} (blocking call —
            the bridge holds the request until the extension answers
            ok / denied / timeout; there is no push, no polling, no
            pending_id, and this module implements none of those)

   No DOM, no rendering, no decisions. Works in the browser UI and in
   Node (global WebSocket) so the identical code path is testable headless.
   All diagnostics go through onStatus/onEvent callbacks or console — never
   stdout-sensitive (this module never touches process.stdout). */

export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:7331";
// Human approval can legitimately take 60s; hold past it with margin.
export const TOOL_TIMEOUT_MS = 70000;
export const HANDSHAKE_TIMEOUT_MS = 8000;
export const TOKEN_KEY = "perscope.playground.token";
export const CLIENT_ID_KEY = "perscope.playground.clientId";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

export function createRuntimeClient({
  url = DEFAULT_BRIDGE_URL,
  storage = null,
  toolTimeoutMs = TOOL_TIMEOUT_MS,
  onStatus = null,
} = {}) {
  const store =
    storage ||
    (typeof localStorage !== "undefined"
      ? localStorage
      : memoryStorage());

  const state = {
    url,
    socket: null,
    connected: false,
    paired: false,
    clientId: null,
    token: null,
    pending: new Map(), // id -> { resolve, reject, timer }
    pairWaiter: null,
    requestCounter: 0,
  };

  const status = () => ({
    connected: state.connected,
    paired: state.paired,
    clientId: state.clientId,
  });

  const emit = () => {
    try {
      onStatus?.(status());
    } catch {
      // Status listeners must never break the transport.
    }
  };

  function send(obj) {
    if (state.socket && state.socket.readyState === 1) {
      state.socket.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function settlePair(message) {
    const waiter = state.pairWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timer);
    state.pairWaiter = null;
    waiter.resolve(message);
  }

  function onSocketMessage(event) {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "paired" || msg.type === "pair-error" || msg.type === "welcome") {
      settlePair(msg);
      return;
    }
    // Correlated tool response. Anything else (no id, unknown type) is
    // ignored: there is no push protocol on this leg by design.
    if (typeof msg.id !== "string") return;
    const entry = state.pending.get(msg.id);
    if (!entry) return;
    state.pending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(msg);
  }

  function onSocketClose() {
    state.connected = false;
    state.paired = false;
    // A dropped socket ends every in-flight call loudly — never a hang.
    for (const [, entry] of state.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("bridge connection closed while waiting for response"));
    }
    state.pending.clear();
    settlePair({ type: "pair-error", reason: "no-connection" });
    emit();
  }

  async function helloIfStored() {
    let token = null;
    try {
      token = store.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) {
      state.paired = false;
      emit();
      return;
    }
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), HANDSHAKE_TIMEOUT_MS);
      const previous = state.pairWaiter;
      state.pairWaiter = {
        timer,
        resolve: (msg) => {
          if (previous) state.pairWaiter = previous;
          resolve(msg && msg.type === "welcome");
        },
      };
      send({ type: "hello", auth: token, role: "agent" });
    });
    if (ok) {
      state.token = token;
      try {
        state.clientId = store.getItem(CLIENT_ID_KEY);
      } catch {
        state.clientId = null;
      }
      state.paired = true;
    } else {
      try {
        store.removeItem(TOKEN_KEY);
        store.removeItem(CLIENT_ID_KEY);
      } catch {
        // Best effort.
      }
      state.token = null;
      state.clientId = null;
      state.paired = false;
    }
    emit();
  }

  function connect(nextUrl) {
    if (nextUrl) state.url = nextUrl;
    if (state.socket) {
      try {
        state.socket.close();
      } catch {
        // Best effort.
      }
      state.socket = null;
    }
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(state.url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const openTimer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Best effort.
        }
        reject(new Error("bridge connect timeout"));
      }, HANDSHAKE_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(openTimer);
        state.socket = socket;
        state.connected = true;
        emit();
        helloIfStored().then(
          () => resolve(status()),
          () => resolve(status()),
        );
      });
      socket.addEventListener("message", onSocketMessage);
      socket.addEventListener("close", onSocketClose);
      socket.addEventListener("error", () => {
        // Errors surface via close; nothing to do here.
      });
    });
  }

  function disconnect() {
    if (state.socket) {
      try {
        state.socket.close();
      } catch {
        // Best effort.
      }
      state.socket = null;
    }
    onSocketClose();
  }

  /** Pair with a dashboard code. Resolves {ok:true} or {ok:false, reason}. */
  function pair(code) {
    return new Promise((resolve) => {
      if (!state.connected) {
        resolve({ ok: false, reason: "no-connection" });
        return;
      }
      const timer = setTimeout(() => {
        state.pairWaiter = null;
        resolve({ ok: false, reason: "timeout" });
      }, HANDSHAKE_TIMEOUT_MS);
      state.pairWaiter = {
        timer,
        resolve: (msg) => {
          if (msg && msg.type === "paired" && msg.token) {
            state.token = msg.token;
            state.clientId = msg.clientId || null;
            state.paired = true;
            try {
              store.setItem(TOKEN_KEY, msg.token);
              if (state.clientId) store.setItem(CLIENT_ID_KEY, state.clientId);
            } catch {
              // Memory-only pairing; still valid for this session.
            }
            emit();
            resolve({ ok: true });
          } else {
            resolve({ ok: false, reason: (msg && msg.reason) || "pair-failed" });
          }
        },
      };
      if (!send({ type: "pair", code: String(code).trim(), role: "agent" })) {
        clearTimeout(timer);
        state.pairWaiter = null;
        resolve({ ok: false, reason: "no-connection" });
      }
    });
  }

  /**
   * Blocking tool call. Resolves with the extension's terminal response
   * ({status:"ok"|"denied"|"timeout"|"error", ...}); rejects only on
   * transport failure (not paired, socket died, local timeout).
   */
  function callTool(tool, params = {}, timeoutMs = toolTimeoutMs) {
    if (!state.connected || !state.paired || !state.token) {
      return Promise.reject(new Error("not paired with the bridge — enter a pairing code first"));
    }
    state.requestCounter += 1;
    const id = `req_${String(state.requestCounter).padStart(3, "0")}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`bridge call timed out after ${timeoutMs}ms: ${tool}`));
      }, timeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      if (!send({ id, tool, params: params ?? {}, auth: state.token })) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(new Error("bridge socket not writable"));
      }
    });
  }

  return { connect, disconnect, pair, callTool, getStatus: status };
}
