import assert from "node:assert/strict";
import test from "node:test";
import { isDestructive } from "../src/shared/is-destructive.js";

test("delete/purchase/send/submit keywords are destructive", () => {
  for (const text of ["Delete Account", "BUY NOW", "Send", "Confirm payment", "Close account", "Transfer funds"]) {
    const r = isDestructive({ tool: "click", text });
    assert.equal(r.destructive, true, text);
    assert.ok(r.reasons.length > 0);
  }
});

test("plain navigation clicks are not destructive", () => {
  assert.deepEqual(isDestructive({ tool: "click", text: "Learn more" }), { destructive: false, reasons: [] });
  assert.deepEqual(isDestructive({ tool: "click", label: "Open settings" }), { destructive: false, reasons: [] });
});

test("submit tool and form submits are always destructive (fail-closed)", () => {
  assert.equal(isDestructive({ tool: "submit", text: "Save draft" }).destructive, true);
  assert.equal(isDestructive({ tool: "click", text: "Next", isFormSubmit: true }).destructive, true);
});

test("typing into known-safe fields is not destructive; unknown kinds are", () => {
  assert.equal(isDestructive({ tool: "type", inputType: "email" }).destructive, false);
  assert.equal(isDestructive({ tool: "type", inputType: "text" }).destructive, false);
  assert.equal(isDestructive({ tool: "type", inputType: "file" }).destructive, true);
  assert.equal(isDestructive({ tool: "type" }).destructive, false);
});

test("unknown tools are destructive (fail-closed, no caller input exists)", () => {
  const r = isDestructive({ tool: "exfiltrate", text: "harmless" });
  assert.equal(r.destructive, true);
  // No caller/source field is consulted — there is nowhere to special-case one.
  assert.ok(!("caller" in r) && !("source" in r));
});
