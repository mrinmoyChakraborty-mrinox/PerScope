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

  // -- Interactive-element enumeration relay --------------------------------
  // Same convention as REQUEST_DOM_CAPTURE above, but asks the content
  // script for its registry-backed [{ref, tag, label, role}] instead of a
  // text snapshot. Read-only: enumeration never mutates the DOM.
  if (message.action === "REQUEST_ELEMENT_LIST") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs && tabs[0] && tabs[0].id;
        if (tabId === undefined || tabId === null) {
          throw new Error("No active tab for element listing");
        }
        const res = await chrome.tabs.sendMessage(tabId, { type: "LIST_ELEMENTS" });
        if (res?.status === "SUCCESS" && Array.isArray(res.elements)) {
          sendResponse({ status: "SUCCESS", elements: res.elements });
        } else {
          sendResponse({ status: "ERROR", error: res?.error || "Element listing failed" });
        }
      } catch (err) {
        sendResponse({ status: "ERROR", error: err.message });
      }
    })();
    return true;
  }

  // -- Open-tab enumeration relay (Manual side tab picker) --------------------
  // chrome.tabs.query needs no extra permission key for ids; titles/URLs
  // ride on the existing <all_urls> host permission. `titlesAvailable`
  // reports whether they actually arrived populated — that boolean is the
  // empirical answer to D4 (fallback = add the "tabs" key if false).
  if (message.action === "LIST_TABS") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const mapped = (tabs || []).map((t) => ({
          tabId: t.id,
          title: t.title || "",
          url: t.url || "",
          active: !!t.active,
        }));
        sendResponse({
          status: "SUCCESS",
          tabs: mapped,
          titlesAvailable: mapped.some((t) => t.title || t.url),
        });
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
  //
  // Readiness race: ensureOffscreenDocument() resolves at creation, not
  // readiness — a fresh offscreen still needs ~1s for WS open + hello
  // with the stored token. Answering instantly would report
  // {connected:false} on every dashboard refresh, i.e. a phantom
  // disconnect/unpair. waitForBridgeReady() polls until the link
  // connects (restored pairing included) or the budget runs out, so
  // callers see the true state on first paint.

  const BRIDGE_READY_POLL_MS = 500;
  const BRIDGE_READY_TIMEOUT_MS = 6000;

  async function queryOffscreenBridge() {
    const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "BRIDGE_STATUS" });
    return res?.bridge || { connected: false, paired: false };
  }

  async function waitForBridgeReady() {
    const deadline = Date.now() + BRIDGE_READY_TIMEOUT_MS;
    let last = { connected: false, paired: false };
    for (;;) {
      try {
        last = await queryOffscreenBridge();
      } catch {
        // Offscreen still booting (receiving end missing) — keep waiting.
        last = { connected: false, paired: false };
      }
      if (last.connected || Date.now() >= deadline) {
        if (last.connected && !last.paired && Date.now() < deadline) {
          // Socket up but hello may still be in flight — brief settle so
          // a restored pairing doesn't flicker as "not paired".
          const settleUntil = Math.min(Date.now() + 1500, deadline);
          while (!last.paired && Date.now() < settleUntil) {
            await new Promise((resolve) => setTimeout(resolve, BRIDGE_READY_POLL_MS));
            try {
              last = await queryOffscreenBridge();
            } catch {
              break;
            }
          }
        }
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, BRIDGE_READY_POLL_MS));
    }
  }

  if (message.action === "BRIDGE_STATUS_UPDATE") {
    updateBridgeBadge(message.status).catch(() => {});
    return false;
  }

  if (message.action === "BRIDGE_STATUS") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const bridge = await waitForBridgeReady();
        updateBridgeBadge(bridge).catch(() => {});
        sendResponse({ status: "SUCCESS", bridge });
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
        // Wait for the socket first: pairing the instant after a refresh
        // must not fail with a phantom "no-connection".
        const ready = await waitForBridgeReady();
        if (!ready.connected) {
          sendResponse({ status: "SUCCESS", ok: false, reason: "no-connection" });
          return;
        }
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

  // -- Action preview/execute relays (T6d) ------------------------------------
  // Same active-tab beta scope as the read path: an explicit tabId answers
  // tab-targeting-requires-tabs-permission. PREVIEW resolves the ref and
  // returns element signals for isDestructive(); EXECUTE performs the
  // approved (or no-gate) action. No auto-injection: a tab without the
  // content script answers with the honest sendMessage error verbatim.
  if (message.action === "REQUEST_PREVIEW" || message.action === "REQUEST_EXECUTE") {
    (async () => {
      try {
        if (message.tabId !== undefined && message.tabId !== null) {
          throw new Error("tab-targeting-requires-tabs-permission");
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs && tabs[0] && tabs[0].id;
        if (tabId === undefined || tabId === null) {
          throw new Error("No active tab for action");
        }
        const res = await chrome.tabs.sendMessage(tabId, {
          type: message.action === "REQUEST_PREVIEW" ? "PREVIEW_ACTION" : "EXECUTE_ACTION",
          tool: message.tool,
          ref: message.ref,
          text: message.text,
          value: message.value,
          direction: message.direction,
          amount: message.amount,
        });
        if (!res || res.status !== "SUCCESS") {
          sendResponse({ status: "ERROR", error: res?.error || "action-failed" });
          return;
        }
        sendResponse({
          status: "SUCCESS",
          ...(res.preview ? { preview: res.preview } : {}),
          ...(res.result ? { result: res.result } : {}),
        });
      } catch (err) {
        sendResponse({ status: "ERROR", error: err.message });
      }
    })();
    return true;
  }

  return false;
});

// -- D7 approval channel (T6d) ------------------------------------------------
// The offscreen document cannot open windows (no chrome.windows there), so
// the service worker owns the popup lifecycle. Offscreen holds a Port open
// for the approval duration — the open port keeps the worker alive across
// the human think-time that would otherwise suspend it mid-wait.
//
// Single timeout owner: APPROVAL_WINDOW_MS here. Expiry, popup dismissal
// (X button), and explicit Deny are all fail-closed (approved:false); only
// an explicit Approve click resolves approved:true.
const APPROVAL_WINDOW_MS = 55000; // under the 60s validator gate / 70s bridge ceiling
const approvalPending = new Map(); // id -> { port, windowId, timer }

function resolveApproval(id, { approved, dismissed, error }) {
  const pending = approvalPending.get(id);
  if (!pending) return;
  approvalPending.delete(id);
  try {
    clearTimeout(pending.timer);
  } catch {}
  try {
    pending.port.postMessage({
      action: "APPROVAL_RESULT",
      id,
      approved: !!approved,
      ...(dismissed ? { dismissed: true } : {}),
      ...(error ? { error } : {}),
    });
  } catch {}
  if (pending.windowId !== undefined && pending.windowId !== null) {
    chrome.windows.remove(pending.windowId).catch(() => {});
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "perscope-approval") return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.action !== "APPROVAL_REQUEST" || typeof msg.id !== "string") return;
    const { id, tool, label, text, reasons } = msg;
    try {
      const query = new URLSearchParams({
        id,
        tool: String(tool || ""),
        label: String(label || ""),
        text: String(text || ""),
        reasons: Array.isArray(reasons) ? reasons.join("; ") : String(reasons || ""),
      });
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL("approval.html") + "?" + query.toString(),
        type: "popup",
        focused: true,
        width: 440,
        height: 560,
      });
      const timer = setTimeout(() => {
        resolveApproval(id, { approved: false, error: "approval-timed-out" });
      }, APPROVAL_WINDOW_MS);
      approvalPending.set(id, { port, windowId: win && win.id, timer });
    } catch (err) {
      try {
        port.postMessage({ action: "APPROVAL_RESULT", id, approved: false, error: err.message });
      } catch {}
    }
  });
  port.onDisconnect.addListener(() => {
    // Offscreen went away (its own backstop fired): drop any orphan popup.
    for (const [id, pending] of approvalPending) {
      if (pending.port === port) {
        approvalPending.delete(id);
        try {
          clearTimeout(pending.timer);
        } catch {}
        if (pending.windowId !== undefined && pending.windowId !== null) {
          chrome.windows.remove(pending.windowId).catch(() => {});
        }
      }
    }
  });
});

// Popup buttons resolve here; closing the popup without deciding is a deny
// (fail-closed), never an implicit approve.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== "background" || message.action !== "APPROVAL_RESOLVE") return false;
  if (typeof message.id !== "string") return false;
  resolveApproval(message.id, { approved: !!message.approved, dismissed: !message.approved && !!message.dismissed });
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, pending] of approvalPending) {
    if (pending.windowId === windowId) {
      resolveApproval(id, { approved: false, dismissed: true });
      break;
    }
  }
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
