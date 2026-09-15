/**
 * Offscreen Host for PerScope ML Pipeline
 * Owns WebGPU device adapter, onnxruntime-web, and canvas redaction
 *
 * Transfer protocol:
 *   INPUT  — imageBytes sent as regular Array<number> from popup/dashboard (MV3 structured-clone
 *            converts ArrayBuffer transfers, but Array is safer across extension contexts).
 *            We reconstruct an ArrayBuffer here before handing to the pipeline.
 *   OUTPUT — redacted PNG returned as base64 string instead of Array<number> to avoid the huge
 *            per-element JSON serialisation overhead (1 MB image = ~4× smaller as base64 than
 *            as a JSON number array, and ~10× faster to serialise/parse).
 */
import { resolveComputeDevice } from "../pipeline/gpu.js";
import { runExtensionPipeline } from "../pipeline/v7-extension.js";

console.log("[PerScope Offscreen] Initialized and listening for pipeline tasks.");

// -- Helpers -----------------------------------------------------------------

/** Convert Uint8Array → base64 string without call-stack overflow */
function uint8ToBase64(bytes) {
  // Use btoa via chunked approach to avoid "max call stack" on large arrays
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// -- Pre-warm ----------------------------------------------------------------
// Schedule model loading during idle time so the first real pipeline run
// doesn't block the UI thread with cold-start weight loading.
function schedulePrewarm() {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(
      () => {
        import("../pipeline/v7-extension.js")
          .then((mod) => mod._prewarmModels?.())
          .catch(() => {});
      },
      { timeout: 8000 }
    );
  }
}

schedulePrewarm();

// -- Message handler ---------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.action === "GET_DEVICE_INFO") {
    resolveComputeDevice(message.forceTier)
      .then((device) => sendResponse({ status: "SUCCESS", device }))
      .catch((err) => sendResponse({ status: "ERROR", error: err.message }));
    return true; // async sendResponse
  }

  if (message.action === "RUN_PIPELINE") {
    const { jobId, imageBytes, options } = message;
    const t0 = performance.now();

    const onProgress = (progress) => {
      chrome.runtime.sendMessage({
        target: "ui",
        action: "PIPELINE_PROGRESS",
        jobId,
        progress,
      });
    };

    (async () => {
      try {
        console.log(`[PerScope Offscreen] Starting pipeline job ${jobId}...`);

        // Reconstruct ArrayBuffer from the number array sent via message
        const buffer = new Uint8Array(imageBytes).buffer;
        const result = await runExtensionPipeline(buffer, options || {}, onProgress);

        // Encode output PNG as base64 — avoids the massive Array.from(Uint8Array)
        // serialisation that was the primary source of UI jitter.
        const outputArrayBuffer = await result.outputBlob.arrayBuffer();
        const outputBase64 = uint8ToBase64(new Uint8Array(outputArrayBuffer));

        const response = {
          status: "SUCCESS",
          jobId,
          outputBase64,
          evidence: result.evidence,
          perceptionPrompt: result.perceptionPrompt,
          computeDevice: result.computeDevice,
          totalTimeMs: Math.round(performance.now() - t0),
        };

        sendResponse(response);
      } catch (error) {
        console.error(`[PerScope Offscreen] Pipeline error on job ${jobId}:`, error);
        sendResponse({
          status: "ERROR",
          jobId,
          error: error.message || String(error),
          stack: error.stack,
        });
      }
    })();

    return true; // Keep message channel open for async response
  }

  return false;
});
