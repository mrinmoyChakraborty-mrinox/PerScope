/**
 * Hardware-accelerated image redaction using OffscreenCanvas
 * Implements exact blurring and opaque black box masking from v7.mjs
 */

export function clampBBox(bbox, width, height, padding = 0) {
  if (!bbox || bbox.length < 4) return null;
  const x1 = Math.max(0, Math.min(width, Math.min(bbox[0], bbox[2]) - padding));
  const y1 = Math.max(0, Math.min(height, Math.min(bbox[1], bbox[3]) - padding));
  const x2 = Math.max(0, Math.min(width, Math.max(bbox[0], bbox[2]) + padding));
  const y2 = Math.max(0, Math.min(height, Math.max(bbox[1], bbox[3]) + padding));

  const w = Math.round(x2 - x1);
  const h = Math.round(y2 - y1);
  if (w <= 0 || h <= 0) return null;

  return {
    left: Math.round(x1),
    top: Math.round(y1),
    width: w,
    height: h,
    bbox: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
  };
}

export function uniqueRedactionRegions(findings) {
  const seen = new Map();
  for (const finding of findings || []) {
    if (!finding?.bbox) continue;
    const bbox = finding.bbox.map(Number);
    if (!bbox.every(Number.isFinite)) continue;
    const key = bbox.map((v) => Math.round(v)).join(",");
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}

export function isFaceFinding(finding) {
  return (
    finding?.entity === "FACE" ||
    finding?.type === "FACE" ||
    finding?.source_id?.startsWith("face_") ||
    finding?.decision_source === "face_detector"
  );
}

/**
 * Renders an irreversible blur over rect using OffscreenCanvas
 */
function renderBlurMask(ctx, sourceCanvas, rect, sigma = 14) {
  const { left, top, width, height } = rect;

  // 1. Draw blurred segment from original image
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.filter = `blur(${Math.max(2, sigma)}px)`;
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();

  // 2. Light translucent overlay for irreversible privacy obfuscation
  ctx.save();
  ctx.fillStyle = "rgba(220, 224, 230, 0.45)";
  ctx.fillRect(left, top, width, height);
  ctx.restore();

  // 3. Second blur pass to soften overlay boundaries
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.filter = `blur(${Math.max(1, Math.round(sigma / 2))}px)`;
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}

/**
 * Renders a solid black privacy box
 */
function renderBlackBox(ctx, rect) {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
  ctx.restore();
}

/**
 * Redacts sensitive text & face regions in an image
 * @param {ImageBitmap|HTMLCanvasElement|OffscreenCanvas} sourceImage
 * @param {Array} findings - List of findings with .bbox and .entity
 * @param {Object} options - Config options (style, padding, sigma)
 * @returns {Promise<{ blob, width, height, textCount, faceCount, totalCount }>}
 */
export async function redactImageOnCanvas(sourceImage, findings, options = {}) {
  const width = Number(sourceImage.width || 0);
  const height = Number(sourceImage.height || 0);

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions for redaction.");
  }

  const textStyle = (options.style || options.redactionStyle || "blur").toLowerCase();
  const faceStyle = (options.faceStyle || options.faceRedactionStyle || "blur").toLowerCase();
  const textPadding = Math.max(0, Number(options.padding ?? 2));
  const facePadding = Math.max(0, Number(options.facePadding ?? 3));
  const textBlurSigma = Math.max(1, Number(options.textBlurSigma ?? 12));
  const faceBlurSigma = Math.max(1, Number(options.faceBlurSigma ?? 14));

  // Create source canvas copy to blur from
  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(sourceImage, 0, 0);

  // Create output canvas
  const outputCanvas = new OffscreenCanvas(width, height);
  const outCtx = outputCanvas.getContext("2d");
  outCtx.drawImage(sourceCanvas, 0, 0);

  const regions = uniqueRedactionRegions(findings);
  let faceCount = 0;
  let textCount = 0;

  for (const region of regions) {
    const isFace = isFaceFinding(region);
    const padding = isFace ? facePadding : textPadding;
    const rect = clampBBox(region.bbox, width, height, padding);
    if (!rect) continue;

    if (isFace) {
      faceCount++;
      if (faceStyle === "blur") {
        renderBlurMask(outCtx, sourceCanvas, rect, faceBlurSigma);
      } else {
        renderBlackBox(outCtx, rect);
      }
    } else {
      textCount++;
      if (textStyle === "blur") {
        renderBlurMask(outCtx, sourceCanvas, rect, textBlurSigma);
      } else {
        renderBlackBox(outCtx, rect);
      }
    }
  }

  const blob = await outputCanvas.convertToBlob({ type: "image/png" });
  console.log(`[CANVAS REDACTOR] Redacted ${textCount} text regions + ${faceCount} face regions onto ${width}x${height} canvas.`);

  return {
    blob,
    width,
    height,
    regionsRedacted: regions.length,
    textRegionsRedacted: textCount,
    faceRegionsRedacted: faceCount,
    regions_redacted: regions.length,
    text_regions_redacted: textCount,
    face_regions_redacted: faceCount,
    textStyle,
    faceStyle,
  };
}
