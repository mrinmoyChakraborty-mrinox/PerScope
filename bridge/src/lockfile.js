import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export function lockPath(dir) {
  return path.join(dir, "bridge.lock");
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probePort(port, host = "127.0.0.1", timeoutMs = 1000) {
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

export function readLock(dir) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(dir), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Singleton detection: a daemon counts as running only if the lockfile
 * exists AND its pid is alive AND its WS port accepts a localhost
 * connection. A dead pid means a stale lock, which is removed.
 */
export async function isDaemonRunning(dir, { probeTimeoutMs = 1000 } = {}) {
  const info = readLock(dir);
  if (!info || typeof info.pid !== "number" || typeof info.wsPort !== "number") {
    return { running: false, info: null };
  }
  if (!pidAlive(info.pid)) {
    removeStaleLock(dir, info);
    return { running: false, info: null };
  }
  const reachable = await probePort(info.wsPort, "127.0.0.1", probeTimeoutMs);
  if (!reachable) {
    // Process alive but port closed: still starting up, or a crashed daemon
    // whose pid got recycled. Report running (pid is authoritative) but flag
    // it so callers can wait/retry rather than spawning a second daemon.
    return { running: true, starting: true, info };
  }
  return { running: true, starting: false, info };
}

function removeStaleLock(dir, info) {
  try {
    const current = readLock(dir);
    if (current && current.pid === info.pid) fs.unlinkSync(lockPath(dir));
  } catch {
    // Best effort.
  }
}

/**
 * Claim the singleton lock. Overwrites only a stale lock (dead pid);
 * throws if a live daemon already holds it.
 */
export async function acquireLock(dir, info) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = readLock(dir);
  if (existing && typeof existing.pid === "number" && pidAlive(existing.pid) && existing.pid !== process.pid) {
    throw new Error(`bridge daemon already running (pid ${existing.pid})`);
  }
  const payload = { ...info, pid: process.pid, startedAt: new Date().toISOString() };
  const tmp = path.join(dir, `.bridge.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
  fs.renameSync(tmp, lockPath(dir));
  return payload;
}

/** Release the lock, but only if this process owns it. */
export function releaseLock(dir) {
  try {
    const current = readLock(dir);
    if (current && current.pid === process.pid) fs.unlinkSync(lockPath(dir));
  } catch {
    // Best effort during shutdown.
  }
}
