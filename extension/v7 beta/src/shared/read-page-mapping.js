/**
 * read_page response mapper — BETA status.
 *
 * Pure module: no chrome APIs, no DOM access, unit-testable in Node.
 * Converts the Tier0 DOM capture result
 * (`captureDOM()` in pipeline/dom-capture.js, delivered via the service
 * worker's REQUEST_DOM_CAPTURE path) into the bridge `read_page` shape
 * `{ status, sanitizedText, findings }`.
 *
 * Privacy rule (locked): allowlisted fields ONLY. Anything resembling raw
 * page text or a DOM locator that is not an allowlisted field is dropped,
 * so a future capture-shape change can never leak raw content onto the
 * wire by accident.
 */

const FINDING_FIELDS = ["type", "source", "confidence", "segmentId", "forceRedacted", "structuralHint"];

function sanitizeFinding(f) {
  if (!f || typeof f !== "object") return null;
  const out = {};
  for (const key of FINDING_FIELDS) {
    if (f[key] !== undefined) out[key] = f[key];
  }
  if (typeof out.source !== "string") out.source = "dom";
  return out;
}

/**
 * @param {object} capture - `res.capture` from REQUEST_DOM_CAPTURE
 * @returns {{ status: "ok", sanitizedText: string, findings: array } |
 *           { status: "error", reason: string }}
 */
export function mapDomCaptureToReadPage(capture) {
  if (!capture || typeof capture !== "object") {
    return { status: "error", reason: "dom-capture-failed" };
  }
  const findings = Array.isArray(capture.findings)
    ? capture.findings.map(sanitizeFinding).filter(Boolean)
    : [];
  return {
    status: "ok",
    sanitizedText: String(capture.redactedDocument ?? ""),
    findings,
  };
}
