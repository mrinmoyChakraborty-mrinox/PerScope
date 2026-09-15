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
  return false;
});
export {
  ensureOffscreenDocument
};
