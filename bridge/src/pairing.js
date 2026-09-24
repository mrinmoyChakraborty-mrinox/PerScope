import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_LOCKOUT_MS = 60 * 1000;

/**
 * Generate a short numeric pairing code. Single-use, expires after
 * PAIRING_CODE_TTL_MS. Returned state object is mutated by verifyPairingCode.
 */
export function generatePairingCode() {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS, attempts: 0, consumed: false, lockedUntil: 0 };
}

export function isCodeExpired(state, now = Date.now()) {
  return state.consumed || now > state.expiresAt;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) {
    // Compare against a same-length dummy so timing doesn't leak length,
    // then fail. (Length of a 6-digit code is not secret, this is hygiene.)
    const dummy = Buffer.alloc(ab.length, 0);
    crypto.timingSafeEqual(ab, dummy);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a user-supplied pairing code against live state.
 * Returns { ok: true } on success (and marks the code consumed so it
 * cannot be reused), or { ok: false, reason } where reason is one of
 * "locked" | "expired" | "incorrect".
 */
export function verifyPairingCode(state, input, now = Date.now()) {
  if (now < state.lockedUntil) return { ok: false, reason: "locked" };
  if (isCodeExpired(state, now)) return { ok: false, reason: "expired" };
  if (!safeEqual(input, state.code)) {
    state.attempts += 1;
    if (state.attempts >= PAIRING_MAX_ATTEMPTS) {
      state.lockedUntil = now + PAIRING_LOCKOUT_MS;
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "incorrect" };
  }
  state.consumed = true;
  return { ok: true };
}

/** Issue a persistent per-client secret token (base64url, 256 bits). */
export function issueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function pairedClientsPath(dir) {
  return path.join(dir, "paired-clients.json");
}

export function loadPairedClients(dir) {
  try {
    const raw = fs.readFileSync(pairedClientsPath(dir), "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.clients)) return data;
    return { clients: [] };
  } catch {
    return { clients: [] };
  }
}

/**
 * Persist paired clients. Stored plaintext with mode 0600 (dir 0700):
 * these are bearer tokens for a localhost-only daemon, and the daemon
 * must compare presented tokens on every message — the standard pattern
 * for local bearer credentials.
 */
export function savePairedClients(dir, data) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort (e.g. non-POSIX filesystems); the file mode below still applies.
  }
  const tmp = path.join(dir, `.paired-clients.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, pairedClientsPath(dir));
  try {
    fs.chmodSync(pairedClientsPath(dir), 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

export function addPairedClient(dir, { clientId, token }) {
  const data = loadPairedClients(dir);
  data.clients = data.clients.filter((c) => c.clientId !== clientId);
  data.clients.push({ clientId, token, pairedAt: new Date().toISOString() });
  savePairedClients(dir, data);
  return data;
}

/** Timing-safe token lookup. Returns the client record or null. */
export function findClientByToken(data, token) {
  const tb = Buffer.from(String(token ?? ""), "utf8");
  for (const c of data.clients) {
    const cb = Buffer.from(String(c.token ?? ""), "utf8");
    if (cb.length !== tb.length) continue;
    if (crypto.timingSafeEqual(cb, tb)) return c;
  }
  return null;
}
