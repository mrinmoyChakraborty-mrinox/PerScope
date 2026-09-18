/**
 * Background Service Worker - Chrome MV3
 * Manages offscreen document lifecycle and tab capture
 */

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    return contexts.length > 0;
  }
  return false;
}

export async function ensureOffscreenDocument() {
  const existing = await hasOffscreenDocument();
  if (existing) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WORKERS", "BLOBS"],
      justification: "Local GPU acceleration for on-device AI perception and image redaction",
    });
    console.log("[Service Worker] Offscreen document created.");
  } catch (err) {
    if (!err.message?.includes("Only a single offscreen document may be created")) {
      console.error("[Service Worker] Failed to create offscreen document:", err);
      throw err;
    }
  }
}

// Ensure offscreen document exists when extension starts
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
});

// Message listener for tab capture and offscreen orchestration
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "background") return false;

  if (message.action === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: "ERROR", error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ status: "SUCCESS", dataUrl });
      }
    });
    return true;
  }

  // -- DOM snapshot capture relay -------------------------------------------
  // Popup sends REQUEST_DOM_CAPTURE -> background forwards CAPTURE_DOM_TEXT
  // to the active tab's top-frame content script (injected with all_frames:
  // true; the top instance aggregates same-origin + cross-origin frames and
  // returns one capture result) -> background hands the aggregated result
  // back to the popup. Same message-passing convention as
  // CAPTURE_VISIBLE_TAB above; the DOM is never mutated by this flow.
  if (message.action === "REQUEST_DOM_CAPTURE") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs && tabs[0] && tabs[0].id;
        if (tabId === undefined || tabId === null) {
          throw new Error("No active tab for DOM capture");
        }
        const res = await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_DOM_TEXT" });
        if (res?.status === "SUCCESS") {
          sendResponse({ status: "SUCCESS", capture: res.capture });
        } else {
          sendResponse({ status: "ERROR", error: res?.error || "DOM capture failed" });
        }
      } catch (err) {
        sendResponse({ status: "ERROR", error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "ENSURE_OFFSCREEN") {
    ensureOffscreenDocument()
      .then(() => sendResponse({ status: "SUCCESS" }))
      .catch((err) => sendResponse({ status: "ERROR", error: err.message }));
    return true;
  }

  // -- Bridge control plane --------------------------------------------------
  // The WS connection itself lives in the offscreen document (MV3 service
  // workers suspend and kill sockets; offscreen stays alive). The worker
  // only relays dashboard/popup callers and owns the action badge, so a
  // missing/dead bridge never affects Human Mode flows above.

  if (message.action === "BRIDGE_STATUS_UPDATE") {
    updateBridgeBadge(message.status).catch(() => {});
    return false;
  }

  if (message.action === "BRIDGE_STATUS") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "BRIDGE_STATUS" });
        if (res?.bridge) updateBridgeBadge(res.bridge).catch(() => {});
        sendResponse({ status: "SUCCESS", bridge: res?.bridge || { connected: false, paired: false } });
      } catch (err) {
        sendResponse({ status: "SUCCESS", bridge: { connected: false, paired: false, error: err.message } });
      }
    })();
    return true;
  }

  if (message.action === "BRIDGE_PAIR") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "BRIDGE_PAIR", code: message.code });
        if (res?.ok) {
          updateBridgeBadge({ connected: true, paired: true }).catch(() => {});
          sendResponse({ status: "SUCCESS", ok: true });
        } else {
          sendResponse({ status: "SUCCESS", ok: false, reason: res?.reason || res?.error || "pair-failed" });
        }
      } catch (err) {
        sendResponse({ status: "SUCCESS", ok: false, reason: err.message });
      }
    })();
    return true;
  }

  return false;
});

/**
 * Persistent bridge signal: green = connected+paired, orange = connected
 * but unpaired, grey = bridge not running. Badge only; never blocks.
 */
async function updateBridgeBadge(s) {
  const paired = !!(s && s.connected && s.paired);
  const connected = !!(s && s.connected);
  try {
    await chrome.action.setBadgeText({ text: paired || connected ? "●" : "" });
    await chrome.action.setBadgeBackgroundColor({
      color: paired ? "#22c55e" : connected ? "#f59e0b" : "#6b7280",
    });
    await chrome.action.setTitle({
      title: paired
        ? "PerScope: bridge connected + paired"
        : connected
          ? "PerScope: bridge reachable, not paired"
          : "PerScope: bridge not running",
    });
  } catch {
    // Badge is best-effort telemetry, never fatal.
  }
}
