import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { isDaemonRunning, lockPath, readLock } from "./lockfile.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cliPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function canConnect(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ensure the singleton daemon is running (spawning it detached if needed),
 * then report how to reach it. Never throws for "already running" — that
 * is the normal case this command exists for.
 */
export async function connectDaemon(config = loadConfig()) {
  let status = await isDaemonRunning(config.dir);
  let started = false;
  if (!status.running) {
    const child = spawn(process.execPath, [cliPath(), "daemon"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    started = true;
  }
  const deadline = Date.now() + 20_000;
  let info = status.info ?? null;
  for (;;) {
    status = await isDaemonRunning(config.dir);
    if (status.running && status.info) {
      info = status.info;
      const probePort = [info.relayPort, info.wsPort, info.httpPort].find((p) => typeof p === "number");
      if (probePort === undefined || (await canConnect(probePort))) break;
      if (!status.starting) break;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the bridge daemon to become ready");
    }
    await sleep(250);
  }
  if (!info || typeof info.wsPort !== "number" || typeof info.httpPort !== "number") {
    throw new Error("bridge daemon lock is missing port info");
  }
  const base = `http://127.0.0.1:${info.httpPort}`;
  const [health, pairing] = await Promise.all([
    fetchJson(`${base}/health`),
    fetchJson(`${base}/pairing-code`),
  ]);
  return {
    started,
    pid: info.pid,
    wsUrl: `ws://127.0.0.1:${info.wsPort}`,
    mcpUrl: `${base}/mcp`,
    dashboardUrl: `${base}/`,
    pairingCode: pairing && pairing.code ? pairing.code : null,
    pairedClients: health && typeof health.pairedClients === "number" ? health.pairedClients : null,
    extensionConnected: !!(health && health.extensionConnected),
  };
}

/**
 * Stop the singleton daemon. Graceful (SIGTERM + wait) unless force is set
 * (immediate SIGKILL). Never kills the calling process itself, and never
 * kills a pid whose ports are all closed unless its lock is fresh (still
 * starting up) — a recycled pid with a stale lock is swept, not signalled.
 */
export async function stopDaemon({ force = false, config = loadConfig() } = {}) {
  const info = readLock(config.dir);
  if (!info || typeof info.pid !== "number") {
    return { stopped: false, reason: "not-running" };
  }
  if (info.pid === process.pid) {
    return { stopped: false, reason: "refusing to stop our own process" };
  }
  const ports = [info.wsPort, info.httpPort, info.relayPort].filter((p) => typeof p === "number");
  const anyOpen = [];
  for (const port of ports) {
    if (await canConnect(port)) anyOpen.push(port);
  }
  const alive = pidAlive(info.pid);
  if (!alive) {
    try {
      fs.unlinkSync(lockPath(config.dir));
    } catch {
      // Best effort.
    }
    return { stopped: false, reason: "not-running" };
  }
  if (anyOpen.length === 0) {
    const ageMs = info.startedAt ? Date.now() - Date.parse(info.startedAt) : Number.POSITIVE_INFINITY;
    if (!(ageMs < 60_000)) {
      // Live pid but nothing listening and not freshly started: almost
      // certainly a recycled pid holding a stale lock. Sweep, don't signal.
      try {
        fs.unlinkSync(lockPath(config.dir));
      } catch {
        // Best effort.
      }
      return { stopped: false, reason: "stale-lock-swept" };
    }
  }
  try {
    process.kill(info.pid, force ? "SIGKILL" : "SIGTERM");
  } catch (err) {
    return { stopped: false, reason: `signal-failed: ${err.message}` };
  }
  if (force) {
    await sleep(500);
  } else {
    const deadline = Date.now() + 8000;
    while (pidAlive(info.pid) && Date.now() < deadline) {
      await sleep(250);
    }
    if (pidAlive(info.pid)) {
      try {
        process.kill(info.pid, "SIGKILL");
      } catch {
        // Best effort.
      }
      await sleep(500);
    }
  }
  const gone = !pidAlive(info.pid);
  if (gone) {
    const check = await isDaemonRunning(config.dir);
    return { stopped: true, pid: info.pid, lockCleared: !check.running };
  }
  return { stopped: false, reason: "process-survived-sigkill" };
}
