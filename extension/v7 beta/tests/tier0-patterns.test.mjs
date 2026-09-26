import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pii = require("../../../piidetector.js");

function types(text) {
  return pii.detectPII(text).detections.map((d) => `${d.type}@${d.start}-${d.end}:${d.value}`);
}

// Deterministic Verhoeff-valid 12-digit number (compute check digit).
function makeValidAadhaar(prefix11) {
  const D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 7, 2, 5],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  for (let i = 0; i < prefix11.length; i++) {
    c = D[c][P[(i + 1) % 8][Number(prefix11[prefix11.length - 1 - i])]];
  }
  return prefix11 + String(INV[c]);
}

test("UPI handles detected; dotted emails stay EMAIL_ID", () => {
  assert.deepEqual(types("pay to user@okhdfcbank now"), ["UPI_VPA@7-22:user@okhdfcbank"]);
  assert.deepEqual(types("john.doe@example.com"), ["EMAIL_ID@0-20:john.doe@example.com"]);
  assert.deepEqual(types("contact me@office"), ["UPI_VPA@8-17:me@office"]);
});

test("Verhoeff gates AADHAAR: valid passes, lookalikes rejected", () => {
  const valid = makeValidAadhaar("23456789012");
  assert.equal(types(`id ${valid} end`).length, 1);
  assert.ok(types(`id ${valid} end`)[0].startsWith("AADHAAR@"));
  assert.deepEqual(types("order 123456789012 shipped"), []);
  assert.deepEqual(types("id 099999999999 end"), []);
  assert.deepEqual(types("short 12345 end"), []);
});

test("label-prefixed spans are value-only (labels survive)", () => {
  assert.deepEqual(types("username john_doe_99"), ["USERNAME@9-20:john_doe_99"]);
  assert.deepEqual(types("password: s3cret!"), ["PASSWORD@10-17:s3cret!"]);
  assert.deepEqual(types("account number 123456789012"), ["BANK_ACCOUNT@15-27:123456789012"]);
  assert.deepEqual(types("PIN: 4829"), ["PIN@5-9:4829"]);
  const redacted = pii.redactPII("username john_doe_99", pii.detectPII("username john_doe_99").detections);
  assert.equal(redacted, "username <USERNAME>");
});

test("context words boost their own families", () => {
  const plain = pii.detectPII("482910").detections;
  const withCtx = pii.detectPII("OTP 482910").detections;
  assert.equal(plain.length, 0);
  assert.equal(withCtx.length, 1);
  assert.ok(withCtx[0].confidence >= 0.75);
});
