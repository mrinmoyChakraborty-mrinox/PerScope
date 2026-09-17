// src/background/service-worker.js
var OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  return false;
}
async function ensureOffscreenDocument() {
  const existing = await hasOffscreenDocument();
  if (existing) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WORKERS", "BLOBS"],
      justification: "Local GPU acceleration for on-device AI perception and image redaction"
    });
    console.log("[Service Worker] Offscreen document created.");
  } catch (err) {
    if (!err.message?.includes("Only a single offscreen document may be created")) {
      console.error("[Service Worker] Failed to create offscreen document:", err);
      throw err;
    }
  }
}
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument().catch(() => {
  });
});
chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {
  });
});
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
  if (message.action === "ENSURE_OFFSCREEN") {
    ensureOffscreenDocument().then(() => sendResponse({ status: "SUCCESS" })).catch((err) => sendResponse({ status: "ERROR", error: err.message }));
    return true;
  }
  if (message.action === "BRIDGE_STATUS_UPDATE") {
    updateBridgeBadge(message.status).catch(() => {
    });
    return false;
  }
  if (message.action === "BRIDGE_STATUS") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "BRIDGE_STATUS" });
        if (res?.bridge) updateBridgeBadge(res.bridge).catch(() => {
        });
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
          updateBridgeBadge({ connected: true, paired: true }).catch(() => {
          });
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
async function updateBridgeBadge(s) {
  const paired = !!(s && s.connected && s.paired);
  const connected = !!(s && s.connected);
  try {
    await chrome.action.setBadgeText({ text: paired || connected ? "\u25CF" : "" });
    await chrome.action.setBadgeBackgroundColor({
      color: paired ? "#22c55e" : connected ? "#f59e0b" : "#6b7280"
    });
    await chrome.action.setTitle({
      title: paired ? "PerScope: bridge connected + paired" : connected ? "PerScope: bridge reachable, not paired" : "PerScope: bridge not running"
    });
  } catch {
  }
}
export {
  ensureOffscreenDocument
};
