/* =========================================================
   PERSCOPE PLAYGROUND — MODEL CLIENT (provider transport)
   =========================================================
   One shared client for every provider mode (LM Studio / Ollama /
   Custom URL / Cloud): all of them are OpenAI-compatible
   POST {baseUrl}/chat/completions with an optional bearer key.
   No per-provider code paths — mode only changes baseUrl, key
   presence, and defaults.

   Privacy discipline (same as runtime-client.js on the bridge token):
   provider config (URLs, keys, model names) NEVER flows into demoState,
   the inspector panes, or the event log. Callers log mode + outcome
   only. The key lives in the closure + storage, nowhere else.

   No DOM. Works in the browser UI and in Node (global fetch) so the
   identical code path is testable headless. */

export const PROVIDER_MODES = ["lmstudio", "ollama", "custom", "cloud"];

export const FORWARDER_DEFAULT_URL = "http://127.0.0.1:7339";

export const PROVIDER_PRESETS = {
  lmstudio: { baseUrl: "http://localhost:1234/v1", needsKey: false },
  ollama: { baseUrl: "http://localhost:11434/v1", needsKey: false },
  custom: { baseUrl: "", needsKey: false },
  cloud: { baseUrl: FORWARDER_DEFAULT_URL, needsKey: true },
};

export const CONFIG_KEY = "perscope.playground.model-config";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

function sanitizeConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  const mode = PROVIDER_MODES.includes(config.mode) ? config.mode : "lmstudio";
  const preset = PROVIDER_PRESETS[mode];
  return {
    mode,
    baseUrl: String(config.baseUrl || preset.baseUrl || "").replace(/\/+$/, ""),
    apiKey: String(config.apiKey || ""),
    model: String(config.model || ""),
    vision: config.vision === true,
  };
}

export function createModelClient({ storage = null } = {}) {
  const store =
    storage ||
    (typeof localStorage !== "undefined"
      ? localStorage
      : memoryStorage());

  let config = sanitizeConfig(null);
  try {
    const saved = store.getItem(CONFIG_KEY);
    if (saved) config = sanitizeConfig(JSON.parse(saved));
  } catch {
    // Corrupt or absent storage starts clean.
  }

  function getConfig() {
    // Returns a copy WITHOUT the key by default — callers that render or
    // log must never receive the secret. Internal send paths use config.
    return {
      mode: config.mode,
      baseUrl: config.baseUrl,
      model: config.model,
      vision: config.vision,
      hasKey: config.apiKey.length > 0,
    };
  }

  function setConfig(next) {
    config = sanitizeConfig({ ...config, ...(next || {}) });
    try {
      store.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Memory-only if storage is unavailable.
    }
    return getConfig();
  }

  function headers() {
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return headers;
  }

  // Uniform error enrichment for every mode (local or forwarder): appends
  // the server's own error payload, truncated. Forwarder payloads carry
  // machine codes (NO_KEY, provider 401s) and never secrets, so this text
  // is safe to display verbatim.
  async function errorSuffix(res) {
    try {
      const text = await res.text();
      return text ? `: ${text.slice(0, 200)}` : " (check URL, CORS, and key)";
    } catch {
      return " (check URL, CORS, and key)";
    }
  }

  function requireReady() {
    if (!config.baseUrl) throw new Error("no provider endpoint configured");
    if (!config.model) throw new Error("no model name configured");
  }

  /** Cheap connectivity + auth check. Never sends a key anywhere except
      the configured endpoint's Authorization header. */
  async function testConnection(timeoutMs = 10000) {
    requireReady();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.baseUrl}/models`, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`endpoint answered HTTP ${res.status}${await errorSuffix(res)}`);
      }
      const body = await res.json().catch(() => null);
      const models = body && Array.isArray(body.data) ? body.data.map((m) => m.id).filter(Boolean) : [];
      return { ok: true, models };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /** OpenAI-compatible chat completion with optional tools. Returns the
      raw assistant message ({role, content, tool_calls?}). */
  async function chatCompletions({ messages, tools = null, timeoutMs = 120000 }) {
    requireReady();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = { model: config.model, messages };
      if (tools) body.tools = tools;
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`provider answered HTTP ${res.status}${await errorSuffix(res)}`);
      }
      const data = await res.json();
      const message = data?.choices?.[0]?.message;
      if (!message) throw new Error("provider returned no assistant message");
      return message;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return { getConfig, setConfig, testConnection, chatCompletions };
}
