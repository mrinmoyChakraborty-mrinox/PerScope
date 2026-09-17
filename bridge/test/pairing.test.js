import assert from "node:assert/strict";
import test from "node:test";
import {
  PAIRING_LOCKOUT_MS,
  PAIRING_MAX_ATTEMPTS,
  findClientByToken,
  generatePairingCode,
  issueToken,
  verifyPairingCode,
} from "../src/pairing.js";

test("pairing code is 6 numeric digits", () => {
  for (let i = 0; i < 20; i += 1) {
    const s = generatePairingCode();
    assert.match(s.code, /^\d{6}$/);
  }
});

test("correct code verifies once, then is consumed", () => {
  const s = generatePairingCode();
  assert.deepEqual(verifyPairingCode(s, s.code), { ok: true });
  assert.equal(verifyPairingCode(s, s.code).ok, false);
});

test("wrong codes count attempts, then lock out", () => {
  const s = generatePairingCode();
  for (let i = 0; i < PAIRING_MAX_ATTEMPTS - 1; i += 1) {
    assert.deepEqual(verifyPairingCode(s, "000000"), { ok: false, reason: "incorrect" });
  }
  assert.deepEqual(verifyPairingCode(s, "000000"), { ok: false, reason: "locked" });
  // Even the right code is rejected while locked.
  assert.deepEqual(verifyPairingCode(s, s.code), { ok: false, reason: "locked" });
});

test("expired codes are rejected", () => {
  const s = generatePairingCode();
  s.expiresAt = Date.now() - 1;
  assert.deepEqual(verifyPairingCode(s, s.code), { ok: false, reason: "expired" });
});

test("lockout expires after PAIRING_LOCKOUT_MS", () => {
  const s = generatePairingCode();
  s.lockedUntil = Date.now() + PAIRING_LOCKOUT_MS;
  assert.deepEqual(verifyPairingCode(s, s.code).reason, "locked");
  const later = verifyPairingCode(s, s.code, Date.now() + PAIRING_LOCKOUT_MS + 1000);
  assert.deepEqual(later, { ok: true });
});

test("issued tokens are unique bearer secrets matched timing-safely", () => {
  const a = issueToken();
  const b = issueToken();
  assert.notEqual(a, b);
  const data = { clients: [{ clientId: "ext-1", token: a }] };
  assert.equal(findClientByToken(data, a)?.clientId, "ext-1");
  assert.equal(findClientByToken(data, b), null);
  assert.equal(findClientByToken(data, ""), null);
});
