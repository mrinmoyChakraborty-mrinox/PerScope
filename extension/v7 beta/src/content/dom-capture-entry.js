/**
 * PerScope DOM Capture — Content Script Entry (browser-only)
 *
 * Listens for `{ type: "CAPTURE_DOM_TEXT" }` via chrome.runtime.onMessage,
 * runs the snapshot pipeline (walk -> classify -> structural hints ->
 * Tier0 per segment -> block-aware rebuild), and responds with the capture
 * result. Never mutates the DOM. Empty findings is a valid, non-error result.
 *
 * Tier0 contract: `detectPII` / `redactPII` are Koyel's piidetector.js exports,
 * imported unmodified. Her confidence scores pass through untouched;
 * structural context travels alongside as `structuralHint`.
 *
 * Frames: this script is injected with `all_frames: true`, so every frame runs
 * its own instance. The top frame (`window === window.top`) owns aggregation:
 * same-origin iframes are recursed synchronously by the walker; cross-origin
 * frames (inaccessible from the top context) are reached through a
 * window.postMessage collect channel with a short timeout. Frames that never
 * respond count into `skipped.iframesCrossOriginUnreachable` — never silently
 * omitted.
 */

import { captureDOMSegments, runTier0OnSegments } from "../pipeline/dom-capture.js";
import { reconstructDocument } from "../pipeline/dom-heuristics.js";
import { enumerateInteractive } from "./refs.js";
import { previewAction, executeAction } from "./actions.js";
// Koyel's Tier0 engine (fixed contract — do not modify piidetector.js).
// Bundled by build.mjs (mirrors the offscreen.js pattern); the `readline`
// CLI branch inside piidetector.js is dead in this context (require.main is
// unset) and `readline` is marked external so it is never loaded.
import { detectPII, redactPII } from "../../../../piidetector.js";

const DETECTOR = { detectPII, redactPII };

const COLLECT_MESSAGE = "__perscope_dom_collect__";
const COLLECT_RESPONSE = "__perscope_dom_response__";
const COLLECT_TIMEOUT_MS = 900;

function isTopFrame() {
  try {
    return typeof window !== "undefined" && window === window.top;
  } catch {
    return false;
  }
}

/**
 * Single-frame capture: walk this frame's document only (no iframe recursion
 * — the top frame coordinates), run Tier0, rebuild. Shared by the top frame
 * (for its own document) and child frames answering the collect channel.
 */
function captureThisFrame() {
  const rootDoc = typeof document !== "undefined" ? document : null;
  const { segments, skipped } = captureDOMSegments(rootDoc, {
    collectCrossOriginFrames: false,
  });
  const { segmentResults, findings } = runTier0OnSegments(segments, DETECTOR);
  const redactedDocument = reconstructDocument(
    segmentResults.map((r) => ({ blockRole: r.segment.blockRole, redactedText: r.redactedText }))
  );
  // Raw text / domPath stay local; drop references before returning.
  for (const r of segmentResults) {
    r.segment.text = "";
    r.segment.domPath = "";
  }
  return { segments: segmentResults, findings, redactedDocument, skipped };
}

/**
 * Top-frame aggregation: local capture + cross-origin frame collection.
 * Same-origin iframes were already recursed synchronously by the walker, so
 * only frames the walker flagged as cross-origin are contacted here.
 */
async function captureAggregated(crossOriginFrames) {
  const local = captureThisFrame();
  const findings = [...local.findings];
  const redactedParts = local.redactedDocument ? [local.redactedDocument] : [];
  const skipped = {
    shadowRootsClosed: local.skipped.shadowRootsClosed,
    iframesCrossOriginUnreachable: 0,
  };
  let frameCount = 1;

  const pending = (crossOriginFrames || []).filter((frame) => {
    try {
      return !!(frame && frame.contentWindow && typeof frame.contentWindow.postMessage === "function");
    } catch {
      return false;
    }
  });

  if (!pending.length) {
    return {
      capturedAt: Date.now(),
      frameCount,
      segmentCount: local.segments.length,
      redactedDocument: redactedParts.join("\n\n"),
      findings,
      skipped,
    };
  }

  const collectId = `collect_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const responses = await new Promise((resolve) => {
    const byId = new Map();
    const onMessage = (event) => {
      try {
        const data = event && event.data;
        if (!data || data.type !== COLLECT_RESPONSE || data.collectId !== collectId) return;
        if (data.result && !byId.has(data.frameToken)) byId.set(data.frameToken, data.result);
      } catch {
        // malformed child response — treated as unreachable below.
      }
    };
    window.addEventListener("message", onMessage);
    pending.forEach((frame, index) => {
      const frameToken = `frame_${index}`;
      try {
        frame.contentWindow.postMessage(
          { type: COLLECT_MESSAGE, collectId, frameToken },
          "*"
        );
      } catch {
        // postMessage itself failed — counted unreachable on timeout path.
      }
    });
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(byId);
    }, COLLECT_TIMEOUT_MS);
  });

  pending.forEach((frame, index) => {
    const frameToken = `frame_${index}`;
    const result = responses.get(frameToken);
    if (!result) {
      skipped.iframesCrossOriginUnreachable += 1;
      return;
    }
    frameCount += 1;
    skipped.shadowRootsClosed += result.skipped ? result.skipped.shadowRootsClosed || 0 : 0;
    if (result.redactedDocument) redactedParts.push(result.redactedDocument);
    for (const f of result.findings || []) findings.push(f);
  });

  return {
    capturedAt: Date.now(),
    frameCount,
    segmentCount: local.segments.length,
    redactedDocument: redactedParts.join("\n\n"),
    findings,
    skipped,
  };
}

// Child-frame collect channel: answer the top frame's postMessage with a
// single-frame capture. Top frame never answers (it aggregates instead).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event) => {
    try {
      const data = event && event.data;
      if (!data || data.type !== COLLECT_MESSAGE) return;
      if (isTopFrame()) return;
      const local = captureThisFrame();
      const payload = {
        type: COLLECT_RESPONSE,
        collectId: data.collectId,
        frameToken: data.frameToken,
        result: {
          redactedDocument: local.redactedDocument,
          findings: local.findings,
          skipped: local.skipped,
        },
      };
      if (event.source && typeof event.source.postMessage === "function") {
        event.source.postMessage(payload, "*");
      } else if (window.parent && typeof window.parent.postMessage === "function") {
        window.parent.postMessage(payload, "*");
      }
    } catch {
      // Capture must never break the page; top frame times out instead.
    }
  });
}

// Single message type this content script handles.
if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    // Interactive-element enumeration (T2c): opaque refs from the
    // per-page registry. Read-only — never mutates the DOM. Response
    // carries ref/tag/label/role only; domPaths stay registry-side.
    if (message.type === "LIST_ELEMENTS") {
      try {
        const elements = enumerateInteractive(
          typeof document !== "undefined" ? document : null
        );
        sendResponse({ status: "SUCCESS", elements });
      } catch (err) {
        sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
      }
      return true;
    }
    if (message.type !== "CAPTURE_DOM_TEXT") {
      // T6d action protocol (preview = read-only signals for isDestructive;
      // execute = the approved/no-gate action itself). Mutating by design —
      // unlike capture/list above, these run only after the bridge-side
      // approval gate (or no-gate verdict for inherently safe tools).
      if (message.type === "PREVIEW_ACTION") {
        try {
          const preview = previewAction(
            typeof document !== "undefined" ? document : null,
            { tool: message.tool, ref: message.ref }
          );
          if (preview.ok) sendResponse({ status: "SUCCESS", preview: preview.signals });
          else sendResponse({ status: "ERROR", error: preview.reason });
        } catch (err) {
          sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
        }
        return true;
      }
      if (message.type === "EXECUTE_ACTION") {
        try {
          const result = executeAction(
            typeof document !== "undefined" ? document : null,
            typeof window !== "undefined" ? window : null,
            {
              tool: message.tool,
              ref: message.ref,
              text: message.text,
              value: message.value,
              direction: message.direction,
              amount: message.amount,
            }
          );
          if (result.ok) sendResponse({ status: "SUCCESS", result: { ref: result.ref ?? null } });
          else sendResponse({ status: "ERROR", error: result.reason });
        } catch (err) {
          sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
        }
        return true;
      }
      return false;
    }
    (async () => {
      try {
        if (isTopFrame()) {
          // Discover cross-origin frames via a synchronous walk first so the
          // top instance knows exactly which frames need postMessage collect.
          const { crossOriginFrames } = captureDOMSegments(
            typeof document !== "undefined" ? document : null,
            { collectCrossOriginFrames: true }
          );
          const aggregated = await captureAggregated(crossOriginFrames || []);
          sendResponse({ status: "SUCCESS", capture: aggregated });
        } else {
          // Directly-addressed non-top frame (e.g. background fan-out):
          // answer with a single-frame result.
          const local = captureThisFrame();
          sendResponse({
            status: "SUCCESS",
            capture: {
              capturedAt: Date.now(),
              frameCount: 1,
              segmentCount: local.segments.length,
              redactedDocument: local.redactedDocument,
              findings: local.findings,
              skipped: {
                ...local.skipped,
                iframesCrossOriginUnreachable: 0,
              },
            },
          });
        }
      } catch (err) {
        // Resilient: an empty-findings result is valid; only hard failures
        // (e.g. Tier0 unavailable) report ERROR — never echo page content.
        sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  });
}
