/**
 * PerScope playground cloud companion (D8, Option B).
 *
 * A tiny localhost-only forwarder so a cloud provider API key NEVER lives
 * in the browser: no devtools Network entry, no page memory, no inspector
 * pane. The UI saves the key here once (POST /config); all later
 * testConnection/chatCompletions calls arrive keyless and this process
 * attaches the bearer server-side before relaying to the provider.
 *
 * Zero dependencies (plain node:http). Binds 127.0.0.1 only — refuses any
 * other host outright. Independent process: shares nothing with the bridge
 * daemon (different ports, no lockfile coupling); bring-up order between
 * the two does not matter.
 *
 *   PERSCOPE_FORWARDER_PORT  listen port (default 7339)
 *   PERSCOPE_CLOUD_API_KEY   seed key (no UI round-trip needed)
 *   PERSCOPE_CLOUD_BASE_URL  seed provider base URL
 *   PERSCOPE_CLOUD_MODEL     seed default model
 *   PERSCOPE_BRIDGE_DIR      state dir for cloud.json (0600), default ~/.perscope
 *
 * Endpoints (all JSON):
 *   POST /config           { apiKey?, providerBaseUrl?, model? } -> { ok, hasKey, providerConfigured }
 *   GET  /models           proxied provider response as-is
 *   POST /chat/completions { model?, messages, tools? } -> provider response as-is
 *
 * Failure shapes are distinguishable by design:
 *   401 passthrough            provider rejected the key
 *   502 {code:NO_KEY}          nothing saved and no env seed
 *   502 {code:PROVIDER_UNREACHABLE}  provider host down / DNS / refused
 *   502 {code:BAD_PROVIDER_RESPONSE} provider answered non-JSON
 *   403                        non-localhost Origin (browser) or wrong method
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT_RAW = (process.env.PERSCOPE_FORWARDER_PORT ?? "7339").trim();
const PORT = PORT_RAW === "0" ? 0 : Number.parseInt(PORT_RAW, 10) || 7339;
const BODY_LIMIT = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

function stateDir() {
  return process.env.PERSCOPE_BRIDGE_DIR || path.join(os.homedir(), ".perscope");
}

function keyFile() {
  return path.join(stateDir(), "cloud.json");
}

function loadSaved() {
  try {
    return JSON.parse(fs.readFileSync(keyFile(), "utf8"));
  } catch {
    return null;
  }
}

const state = {
  apiKey: process.env.PERSCOPE_CLOUD_API_KEY || "",
  providerBaseUrl: (process.env.PERSCOPE_CLOUD_BASE_URL || "").replace(/\/+$/, ""),
  model: process.env.PERSCOPE_CLOUD_MODEL || "",
};
const saved = loadSaved();
if (saved && typeof saved === "object") {
  if (typeof saved.apiKey === "string" && saved.apiKey) state.apiKey = saved.apiKey;
  if (typeof saved.providerBaseUrl === "string" && saved.providerBaseUrl) {
    state.providerBaseUrl = saved.providerBaseUrl.replace(/\/+$/, "");
  }
  if (typeof saved.model === "string" && saved.model) state.model = saved.model;
}

function persist() {
  try {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(stateDir(), 0o700);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
    fs.writeFileSync(
      keyFile(),
      JSON.stringify({ apiKey: state.apiKey, providerBaseUrl: state.providerBaseUrl, model: state.model }),
      { mode: 0o600 },
    );
    try {
      fs.chmodSync(keyFile(), 0o600);
    } catch {
      // Best effort.
    }
  } catch {
    // Memory-only if the filesystem is unavailable.
  }
}

function isLocalOrigin(origin) {
  if (!origin) return true; // non-browser callers (curl, Node) have no Origin
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function cors(res, origin) {
  if (origin && isLocalOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, status, obj, origin) {
  cors(res, origin);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function relay(pathSuffix, { method, queryBody, timeoutMs }) {
  if (!state.apiKey) {
    const err = new Error("no cloud key configured — save one via POST /config or set PERSCOPE_CLOUD_API_KEY");
    err.code = "NO_KEY";
    err.status = 502;
    throw err;
  }
  if (!state.providerBaseUrl) {
    const err = new Error("no provider base URL configured — save one via POST /config or set PERSCOPE_CLOUD_BASE_URL");
    err.code = "NO_PROVIDER";
    err.status = 502;
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${state.providerBaseUrl}${pathSuffix}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: queryBody !== undefined ? JSON.stringify(queryBody) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const err = new Error("provider answered non-JSON (HTTP " + res.status + ")");
      err.code = "BAD_PROVIDER_RESPONSE";
      err.status = 502;
      throw err;
    }
    // Provider verdicts (including 401 key rejection) pass through VERBATIM —
    // status and body — so callers can distinguish auth failure from outages.
    return { status: res.status, data };
  } catch (err) {
    if (err && (err.code === "NO_KEY" || err.code === "NO_PROVIDER" || err.code === "BAD_PROVIDER_RESPONSE")) throw err;
    const mapped = new Error(
      err && err.name === "AbortError" ? "provider timed out" : `provider unreachable (${(err && err.message) || err})`
    );
    mapped.code = "PROVIDER_UNREACHABLE";
    mapped.status = 502;
    throw mapped;
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    if (!isLocalOrigin(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    cors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }
  if (origin && !isLocalOrigin(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "FORBIDDEN_ORIGIN", message: "localhost only" } }));
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "POST" && url.pathname === "/config") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      json(res, 400, { error: { code: "BAD_BODY", message: err.message } }, origin);
      return;
    }
    if (typeof body.apiKey === "string" && body.apiKey) state.apiKey = body.apiKey;
    if (typeof body.providerBaseUrl === "string" && body.providerBaseUrl) {
      state.providerBaseUrl = body.providerBaseUrl.replace(/\/+$/, "");
    }
    if (typeof body.model === "string" && body.model) state.model = body.model;
    persist();
    // NEVER echoes the key (or anything derived from it).
    json(res, 200, {
      ok: true,
      hasKey: state.apiKey.length > 0,
      providerConfigured: state.providerBaseUrl.length > 0,
      model: state.model || null,
    }, origin);
    return;
  }

  if (req.method === "GET" && url.pathname === "/models") {
    try {
      const { status, data } = await relay("/models", { method: "GET", timeoutMs: 15000 });
      json(res, status, data ?? {}, origin);
    } catch (err) {
      json(res, err.status || 502, { error: { code: err.code || "FORWARDER_ERROR", message: err.message } }, origin);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/chat/completions") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      json(res, 400, { error: { code: "BAD_BODY", message: err.message } }, origin);
      return;
    }
    if (!body || !Array.isArray(body.messages)) {
      json(res, 400, { error: { code: "BAD_BODY", message: "messages array is required" } }, origin);
      return;
    }
    try {
      const { status, data } = await relay("/chat/completions", {
        method: "POST",
        queryBody: {
          model: typeof body.model === "string" && body.model ? body.model : state.model,
          messages: body.messages,
          ...(body.tools ? { tools: body.tools } : {}),
        },
      });
      json(res, status, data ?? {}, origin);
    } catch (err) {
      json(res, err.status || 502, { error: { code: err.code || "FORWARDER_ERROR", message: err.message } }, origin);
    }
    return;
  }

  json(res, 404, { error: { code: "NOT_FOUND", message: "use POST /config, GET /models, POST /chat/completions" } }, origin);
});

server.listen(PORT, HOST, () => {
  const bound = server.address() && server.address().port;
  console.log(`[perscope-forwarder] listening on http://${HOST}:${bound} (localhost only)`);
});
