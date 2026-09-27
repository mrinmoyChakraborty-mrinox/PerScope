/**
 * PerScope side panel — live on-device status.
 *
 * Same message protocol as the popup (no mock data): device info comes from
 * the offscreen host (GET_DEVICE_INFO) and bridge state from the background
 * service worker (BRIDGE_STATUS). Outside the packaged extension it shows a
 * preview notice instead of fake values.
 */

const hasExtensionAPIs =
  typeof chrome !== "undefined" && !!(chrome && chrome.runtime && chrome.runtime.sendMessage);

const shell = document.getElementById("panelShell");
const themeIcon = document.getElementById("themeIcon");
const deviceLabel = document.getElementById("deviceLabel");
const deviceTier = document.getElementById("deviceTier");
const bridgeLabel = document.getElementById("bridgeLabel");
const updatedLabel = document.getElementById("updatedLabel");

const ICON_SUN =
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';

function loadTheme() {
  try {
    return window.localStorage.getItem("perscope-theme") || "light";
  } catch {
    return "light";
  }
}

function applyTheme(t) {
  shell.setAttribute("data-theme", t);
  themeIcon.innerHTML = t === "dark" ? ICON_MOON : ICON_SUN;
  try {
    window.localStorage.setItem("perscope-theme", t);
  } catch {
    /* non-fatal */
  }
}

document.getElementById("btnTheme").addEventListener("click", () => {
  applyTheme(shell.getAttribute("data-theme") === "light" ? "dark" : "light");
});

function stamp() {
  try {
    updatedLabel.textContent = new Date().toLocaleTimeString();
  } catch {
    updatedLabel.textContent = "just now";
  }
}

async function refreshStatus() {
  if (!hasExtensionAPIs) {
    deviceLabel.textContent = "Preview mode";
    deviceTier.textContent = "—";
    bridgeLabel.textContent = "Not in packaged extension";
    stamp();
    return;
  }
  deviceLabel.textContent = "Detecting…";
  bridgeLabel.textContent = "Checking…";
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "GET_DEVICE_INFO" });
    const d = (res && res.device) || {};
    deviceLabel.textContent = d.label || d.description || "Hardware accelerator";
    deviceTier.textContent = String(d.tier || "cpu").toUpperCase();
  } catch {
    deviceLabel.textContent = "Unavailable";
    deviceTier.textContent = "—";
  }
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_STATUS" });
    const b = (res && res.bridge) || {};
    bridgeLabel.textContent = b.paired
      ? "Connected + paired"
      : b.connected
        ? "Reachable, not paired"
        : "Not running";
  } catch {
    bridgeLabel.textContent = "Not running";
  }
  stamp();
}

document.getElementById("btnRefresh").addEventListener("click", () => void refreshStatus);

document.getElementById("btnOpenDashboard").addEventListener("click", () => {
  if (hasExtensionAPIs && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  } else {
    window.open("about:blank", "_blank");
  }
});

applyTheme(loadTheme() === "dark" ? "dark" : "light");
void refreshStatus();
