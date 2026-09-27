import assert from "node:assert/strict";
import test from "node:test";
import { mapDomCaptureToReadPage } from "../src/shared/read-page-mapping.js";

const RAW = "john.doe@example.com lives at 221B Baker Street";

function tier0Capture() {
  return {
    capturedAt: 1234567890,
    frameCount: 1,
    segmentCount: 2,
    redactedDocument: "Contact [REDACTED:EMAIL] for details.",
    findings: [
      {
        type: "EMAIL",
        source: "dom",
        confidence: 0.97,
        segmentId: "seg-3",
        forceRedacted: false,
        structuralHint: { kind: "label", text: "Email" },
        // Decoys: shaped like things that must never reach the wire.
        text: RAW,
        domPath: "/html/body/div[2]/span",
        extra: { nested: RAW },
      },
    ],
    skipped: { iframesCrossOriginUnreachable: 0 },
  };
}

test("read_page carries sanitized text + dom findings", () => {
  const out = mapDomCaptureToReadPage(tier0Capture());
  assert.equal(out.status, "ok");
  assert.equal(out.sanitizedText, "Contact [REDACTED:EMAIL] for details.");
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].type, "EMAIL");
  assert.equal(out.findings[0].source, "dom");
});

test("no raw text or locators survive onto the wire object", () => {
  const out = mapDomCaptureToReadPage(tier0Capture());
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes(RAW.split(" ")[0]), "raw value leaked");
  assert.ok(!wire.includes("Baker Street"), "raw value leaked");
  assert.ok(!wire.includes("domPath"), "locator field leaked");
  assert.ok(!wire.includes("nested"), "undeclared field leaked");
  assert.deepEqual(Object.keys(out).sort(), ["findings", "sanitizedText", "status"]);
});

test("missing/empty capture is an honest error, never empty-ok", () => {
  assert.deepEqual(mapDomCaptureToReadPage(null), { status: "error", reason: "dom-capture-failed" });
  assert.deepEqual(mapDomCaptureToReadPage("nope"), { status: "error", reason: "dom-capture-failed" });
  const empty = mapDomCaptureToReadPage({ redactedDocument: "", findings: [] });
  assert.equal(empty.status, "ok");
  assert.equal(empty.sanitizedText, "");
  assert.deepEqual(empty.findings, []);
});

test("non-object findings are dropped, source defaults to dom", () => {
  const out = mapDomCaptureToReadPage({
    redactedDocument: "hi",
    findings: [null, "x", { type: "PHONE" }],
  });
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].source, "dom");
});
