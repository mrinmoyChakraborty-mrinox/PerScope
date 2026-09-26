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
import { mapDomCaptureToReadPage } from "../shared/read-page-mapping.js";
import { startBridgeLink } from "./bridge-link.js";

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

// -- Pipeline job (shared by popup UI and bridge capture_tab) ----------------
// Refactored out of the RUN_PIPELINE handler so the bridge route invokes the
// exact same path the popup's Capture button triggers — no divergent logic.
async function runPipelineJob({ jobId, imageBytes, options, onProgress }) {
  const t0 = performance.now();
  // Reconstruct ArrayBuffer from the number array sent via message
  const buffer = new Uint8Array(imageBytes).buffer;
  const result = await runExtensionPipeline(buffer, options || {}, onProgress);

  // Encode output PNG as base64 — avoids the massive Array.from(Uint8Array)
  // serialisation that was the primary source of UI jitter.
  const outputArrayBuffer = await result.outputBlob.arrayBuffer();
  const outputBase64 = uint8ToBase64(new Uint8Array(outputArrayBuffer));

  return {
    status: "SUCCESS",
    jobId,
    outputBase64,
    evidence: result.evidence,
    perceptionPrompt: result.perceptionPrompt,
    computeDevice: result.computeDevice,
    totalTimeMs: Math.round(performance.now() - t0),
  };
}

// -- Bridge tool routing -----------------------------------------------------
// capture_tab runs the real image pipeline. read_page reuses the existing
// SW REQUEST_DOM_CAPTURE path (content script + Tier0, active tab) and maps
// it to the bridge {sanitizedText, findings} shape. Remaining DOM tools
// (list/count/act) need element enumeration + refs, still Final scope —
// they answer with an explicit error, never silence and never fake data.
const DOM_DEFERRED = new Set([
  "list_interactive_elements",
  "click",
  "type",
  "select_option",
  "submit",
  "scroll",
]);

async function handleBridgeTool({ tool, params }) {
  if (tool === "capture_tab") {
    // Beta scope: active-tab capture only. Targeting an arbitrary tabId
    // needs the "tabs" permission, deferred to Final with scripting.
    if (params && params.tabId !== undefined && params.tabId !== null) {
      return { status: "error", reason: "tab-targeting-requires-tabs-permission" };
    }
    try {
      // chrome.tabs is unavailable in offscreen documents, so capture goes
      // through the service worker (same action the popup uses).
      const cap = await chrome.runtime.sendMessage({ target: "background", action: "CAPTURE_VISIBLE_TAB" });
      if (!cap?.dataUrl) {
        return { status: "error", reason: cap?.error || "capture-failed" };
      }
      const blob = await (await fetch(cap.dataUrl)).blob();
      const imageBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const jobId = `bridge_${Date.now()}`;
      const res = await runPipelineJob({ jobId, imageBytes, options: {}, onProgress: () => {} });
      return {
        status: "ok",
        redactedImage: res.outputBase64,
        evidence: res.evidence,
        totalTimeMs: res.totalTimeMs,
        computeDevice: res.computeDevice,
      };
    } catch (err) {
      return { status: "error", reason: err?.message || "pipeline-failed" };
    }
  }
  if (tool === "read_page") {
    // Beta scope: active-tab DOM only. Targeting an arbitrary tabId needs
    // the list_tabs tool (D4), still pending.
    if (params && params.tabId !== undefined && params.tabId !== null) {
      return { status: "error", reason: "tab-targeting-requires-tabs-permission" };
    }
    try {
      // chrome.tabs is unavailable in offscreen documents, so DOM capture
      // goes through the service worker (same action the popup uses).
      const res = await chrome.runtime.sendMessage({ target: "background", action: "REQUEST_DOM_CAPTURE" });
      if (!res || res.status !== "SUCCESS" || !res.capture) {
        return { status: "error", reason: res?.error || "dom-capture-failed" };
      }
      return mapDomCaptureToReadPage(res.capture);
    } catch (err) {
      return { status: "error", reason: err?.message || "dom-capture-failed" };
    }
  }
  if (DOM_DEFERRED.has(tool)) {
    return {
      status: "error",
      reason: "dom-not-implemented-in-beta",
      detail: `${tool} needs element enumeration + refs (T2c scope). This beta serves capture_tab + read_page only.`,
    };
  }
  return { status: "error", reason: `unknown-tool:${tool}` };
}

const bridgeLink = startBridgeLink({
  onToolRequest: handleBridgeTool,
  onStatusChange: (s) => {
    // Service worker owns the badge; offscreen just reports.
    chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_STATUS_UPDATE", status: s }).catch(() => {});
  },
});
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
        sendResponse(await runPipelineJob({ jobId, imageBytes, options, onProgress }));
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

  // -- Bridge control plane (from SW relay: dashboard/popup callers) ---------
  if (message.action === "BRIDGE_STATUS") {
    sendResponse({ status: "SUCCESS", bridge: bridgeLink.getStatus() });
    return false;
  }

  if (message.action === "BRIDGE_PAIR") {
    bridgeLink
      .submitPairingCode(message.code)
      .then((res) => sendResponse({ status: "SUCCESS", ...res }))
      .catch((err) => sendResponse({ status: "ERROR", error: err?.message || String(err) }));
    return true;
  }

  return false;
});
