/* PerScope benchmark harness — redaction evaluation (Phase 5).
 *
 * Compares ground-truth sensitive regions against the ACTUAL redaction output:
 * predicted regions are the pipeline's final finding bboxes passed through the
 * same dedup semantics as src/pipeline/canvas-redactor.js uniqueRedactionRegions
 * (rounded-coordinate key) and clampBBox (padding + image-bounds clamp). The
 * per-run region counts (textRegions/faceRegions) come from the pipeline's own
 * REDACT stage info, i.e. what canvas-redactor really rendered — never a fake
 * redactor. Pixel rendering itself needs OffscreenCanvas (browser-only), so this
 * module scores geometry + text outcomes, the two things measurable from
 * evidence in Node.
 *
 * Metrics (all deterministic):
 *   - textCoverage (redaction recall): REDACT text GT entities with >= 1
 *     predicted text region (accuracy.mjs textMatch) / all REDACT text GT.
 *   - underRedaction = 1 - textCoverage.
 *   - boxIoU: for GT entities WITH bboxes, best IoU against predicted boxes
 *     (pixel space [x1,y1,x2,y2]); mean over GT boxes; null when no GT boxes.
 *   - boxRecall@0.5: fraction of GT boxes with best IoU >= 0.5; null if no boxes.
 *   - overRedaction: predicted text findings matching LEAVE GT / all predictions.
 *   - preservation: LEAVE GT entities untouched by any prediction / all LEAVE.
 *   - ocrLeak: REDACT GT texts still present verbatim (normalized) in
 *     evidence.redaction.redacted_ocr_text; ocrPreserved: LEAVE GT texts still
 *     present there. Both null when redacted_ocr_text is unavailable.
 */

import { normalizeText, textMatch } from "./accuracy.mjs";

export function boxArea(b) {
  const w = Math.max(0, b[2] - b[0]);
  const h = Math.max(0, b[3] - b[1]);
  return w * h;
}

export function boxIoU(a, b) {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter <= 0) return 0;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function validBox(b) {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    boxArea(b) > 0
  );
}

/* Mirror of canvas-redactor.js uniqueRedactionRegions: dedup by rounded key. */
export function dedupRegions(findings) {
  const seen = new Map();
  for (const f of findings || []) {
    if (!validBox(f.bbox)) continue;
    const key = f.bbox.map((v) => Math.round(Number(v))).join(",");
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/* Mirror of canvas-redactor.js clampBBox (padding + image-bounds clamp). */
export function clampRegion(bbox, width, height, padding = 2) {
  if (!validBox(bbox) || !(width > 0) || !(height > 0)) return null;
  const x1 = Math.max(0, Math.min(width, Math.min(bbox[0], bbox[2]) - padding));
  const y1 = Math.max(0, Math.min(height, Math.min(bbox[1], bbox[3]) - padding));
  const x2 = Math.max(0, Math.min(width, Math.max(bbox[0], bbox[2]) + padding));
  const y2 = Math.max(0, Math.min(height, Math.max(bbox[1], bbox[3]) + padding));
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null;
  return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)];
}

export function evaluateRedaction(gtEntities, findings, opts = {}) {
  const { imageWidth = 0, imageHeight = 0, redactedOcrText = null, padding = 2 } = opts;
  const fs = Array.isArray(findings) ? findings : [];
  const redactText = (gtEntities || []).filter((e) => e.action === "REDACT" && e.text);
  const leaveAll = (gtEntities || []).filter((e) => e.action === "LEAVE");
  const gtBoxes = (gtEntities || []).filter((e) => e.action === "REDACT" && validBox(e.bbox));

  const predicted = dedupRegions(fs).map((f) => ({
    finding: f,
    clamped: clampRegion(f.bbox, imageWidth, imageHeight, padding),
  }));
  const predictedBoxes = predicted.map((p) => p.clamped).filter(Boolean);

  let covered = 0;
  for (const g of redactText) {
    if (fs.some((f) => textMatch(g.text, f.text))) covered++;
  }
  const textCoverage = redactText.length ? covered / redactText.length : null;
  const underRedaction = textCoverage === null ? null : 1 - textCoverage;

  let bestIoUs = [];
  if (gtBoxes.length && predictedBoxes.length) {
    bestIoUs = gtBoxes.map((g) => Math.max(...predictedBoxes.map((p) => boxIoU(g.bbox, p))));
  } else if (gtBoxes.length) {
    bestIoUs = gtBoxes.map(() => 0);
  }
  const meanIoU = bestIoUs.length
    ? bestIoUs.reduce((a, b) => a + b, 0) / bestIoUs.length
    : null;
  const boxRecallAt50 = bestIoUs.length ? bestIoUs.filter((v) => v >= 0.5).length / bestIoUs.length : null;

  let leaveHit = 0;
  for (const g of leaveAll) {
    if (!g.text) continue;
    if (fs.some((f) => textMatch(g.text, f.text))) leaveHit++;
  }
  const leaveWithText = leaveAll.filter((g) => g.text).length;
  const overRedaction = fs.length ? leaveHit / fs.length : null;
  const preservation = leaveWithText ? (leaveWithText - leaveHit) / leaveWithText : null;

  let ocrLeak = null;
  let ocrPreserved = null;
  if (typeof redactedOcrText === "string") {
    const normOcr = normalizeText(redactedOcrText);
    const leaked = redactText.filter((g) => {
      const n = normalizeText(g.text);
      return n && n.length >= 4 && normOcr.includes(n);
    }).length;
    ocrLeak = redactText.length ? leaked / redactText.length : null;
    const kept = leaveAll
      .filter((g) => g.text)
      .filter((g) => {
        const n = normalizeText(g.text);
        return n && n.length >= 4 && normOcr.includes(n);
      }).length;
    ocrPreserved = leaveWithText ? kept / leaveWithText : null;
  }

  return {
    predictedRegions: predicted.length,
    predictedBoxes: predictedBoxes.length,
    gtBoxes: gtBoxes.length,
    textCoverage,
    underRedaction,
    meanIoU,
    boxRecallAt50,
    overRedaction,
    preservation,
    ocrLeak,
    ocrPreserved,
  };
}
