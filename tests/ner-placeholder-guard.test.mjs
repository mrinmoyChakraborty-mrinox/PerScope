import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pii = require("../piidetector.js");

test("placeholder spans are dropped, real spans kept", () => {
  const text = "My name is <FIRST_NAME> and I live in Berlin.";
  const out = pii.stripPlaceholderDetections(
    [
      { type: "CITY", start: 10, end: 15 }, // inside <FIRST_NAME>
      { type: "CITY", start: 36, end: 42 }, // Berlin
    ],
    text,
  );
  assert.deepEqual(out.map((d) => d.type), ["CITY"]);
  assert.equal(out[0].start, 36);
});

test("partial overlap with a placeholder is dropped (fail-closed)", () => {
  const text = "x <PIN> y";
  const out = pii.stripPlaceholderDetections([{ type: "X", start: 1, end: 4 }], text);
  assert.deepEqual(out, []);
});

test("no placeholders returns input detections unchanged", () => {
  const dets = [{ type: "EMAIL_ID", start: 0, end: 5 }];
  assert.deepEqual(pii.stripPlaceholderDetections(dets, "a@b.co"), dets);
  assert.deepEqual(pii.stripPlaceholderDetections([], "plain"), []);
});
