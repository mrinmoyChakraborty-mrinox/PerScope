// src/app/dashboard.js
var hasExtensionAPIs = typeof chrome !== "undefined" && !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
var originalBlob = null;
var originalUrl = null;
var redactedBlob = null;
var redactedUrl = null;
var evidenceData = null;
var activeJobId = null;
var D = {
  shell: document.getElementById("dashShell"),
  themeIcon: document.getElementById("dashThemeIcon"),
  dashDeviceTier: document.getElementById("dashDeviceTier"),
  dashPulseDot: document.getElementById("dashPulseDot"),
  dashDeviceName: document.getElementById("dashDeviceName"),
  teleBackend: document.getElementById("teleBackend"),
  teleVendor: document.getElementById("teleVendor"),
  telePower: document.getElementById("telePower"),
  dashSelectDevice: document.getElementById("dashSelectDevice"),
  dashSelectStyle: document.getElementById("dashSelectStyle"),
  dashCheckFastVLM: document.getElementById("dashCheckFastVLM"),
  dashCheckFace: document.getElementById("dashCheckFace"),
  dashBtnUpload: document.getElementById("dashBtnUpload"),
  dashBtnCapture: document.getElementById("dashBtnCapture"),
  dashFileInput: document.getElementById("dashFileInput"),
  dashDropZone: document.getElementById("dashDropZone"),
  viewportOriginal: document.getElementById("viewportOriginal"),
  viewportRedacted: document.getElementById("viewportRedacted"),
  dashStatusIndicator: document.getElementById("dashStatusIndicator"),
  dashBtnDownloadPNG: document.getElementById("dashBtnDownloadPNG"),
  dashBtnCopy: document.getElementById("dashBtnCopy"),
  dashBtnDownloadJSON: document.getElementById("dashBtnDownloadJSON"),
  dashToggleOverlay: document.getElementById("dashToggleOverlay"),
  dashEmptyPlaceholder: document.getElementById("dashEmptyPlaceholder"),
  dashCaptionText: document.getElementById("dashCaptionText"),
  dashJsonViewer: document.getElementById("dashJsonViewer"),
  dashPromptViewer: document.getElementById("dashPromptViewer"),
  dashBridgeStatus: document.getElementById("dashBridgeStatus"),
  dashBridgeCode: document.getElementById("dashBridgeCode"),
  dashBridgePair: document.getElementById("dashBridgePair"),
  dashBridgeMsg: document.getElementById("dashBridgeMsg")
};
var DEFAULT_STATUS = "Ready \xB7 On-device processing";
var hasStorageAPI = hasExtensionAPIs && !!(chrome.storage && chrome.storage.local);
async function storeGet(key) {
  if (hasStorageAPI) {
    try {
      const out = await chrome.storage.local.get([key]);
      return out ? out[key] : void 0;
    } catch {
    }
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? void 0 : JSON.parse(raw);
  } catch {
    return void 0;
  }
}
async function storeSet(key, value) {
  if (hasStorageAPI) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return;
    } catch {
    }
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
var ICON_SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
var ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';
function applyTheme(t, persist = true) {
  D.shell.setAttribute("data-theme", t);
  D.themeIcon.innerHTML = t === "dark" ? ICON_MOON : ICON_SUN;
  if (persist) void storeSet("perscope-theme", t);
}
document.getElementById("dashBtnTheme").addEventListener("click", () => {
  applyTheme(D.shell.getAttribute("data-theme") === "light" ? "dark" : "light");
});
function getForceTier() {
  const v = D.dashSelectDevice.value || "";
  if (v.startsWith("Integrated")) return "integrated";
  if (v.startsWith("CPU")) return "cpu";
  return null;
}
function getRedactionStyle() {
  return (D.dashSelectStyle.value || "").startsWith("Solid") ? "black" : "blur";
}
function currentPipelineOptions() {
  return {
    forceDeviceTier: getForceTier(),
    redactionStyle: getRedactionStyle(),
    fastvlmEnabled: D.dashCheckFastVLM.checked,
    faceEnabled: D.dashCheckFace.checked
  };
}
async function initDashboardDevice() {
  if (!hasExtensionAPIs) {
    D.dashDeviceTier.textContent = "Preview mode";
    D.dashDeviceName.textContent = "Open the packaged extension for live telemetry";
    return;
  }
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "GET_DEVICE_INFO",
      forceTier: getForceTier()
    });
    if (res && res.device) updateDeviceTelemetry(res.device);
  } catch (err) {
    console.warn("Dashboard device detection failed:", err);
  }
}
function updateDeviceTelemetry(device) {
  const tier = device.tier || "cpu";
  D.dashDeviceTier.textContent = `${tier.toUpperCase()} ACCELERATOR`;
  D.dashDeviceName.textContent = device.label || device.description || "Device";
  D.teleBackend.textContent = device.type === "webgpu" ? "WebGPU" : "WASM Multi-thread";
  D.teleVendor.textContent = device.vendor || "N/A";
  D.telePower.textContent = device.highPerformance ? "High-Performance (Dedicated)" : "Balanced / Integrated";
  D.dashPulseDot.style.background = tier === "dedicated" ? "#10b981" : tier === "integrated" ? "#06b6d4" : "#f59e0b";
}
function isImageFile(file) {
  return !!file && !!file.type && file.type.startsWith("image/");
}
D.dashBtnUpload.addEventListener("click", () => D.dashFileInput.click());
D.dashDropZone.addEventListener("click", () => D.dashFileInput.click());
D.dashFileInput.addEventListener("change", () => {
  const file = D.dashFileInput.files && D.dashFileInput.files[0];
  if (file) handleImageFile(file);
  D.dashFileInput.value = "";
});
D.viewportOriginal.addEventListener("dragover", (e) => e.preventDefault());
D.viewportOriginal.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});
D.dashBtnCapture.addEventListener("click", async () => {
  if (!hasExtensionAPIs) {
    alert("Tab capture needs the packaged extension \u2014 use Upload New Image for preview.");
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({
      target: "background",
      action: "CAPTURE_VISIBLE_TAB"
    });
    if (res && res.dataUrl) {
      const blob = await (await fetch(res.dataUrl)).blob();
      handleImageFile(blob);
    } else {
      throw new Error(res && res.error || "Tab capture failed");
    }
  } catch (err) {
    alert("Capture failed: " + err.message);
  }
});
function handleImageFile(file) {
  if (!isImageFile(file)) {
    alert("That file isn\u2019t an image \u2014 pick a PNG, JPG or WebP.");
    return;
  }
  if (!hasExtensionAPIs) {
    showOriginalPreview(URL.createObjectURL(file));
    D.dashStatusIndicator.textContent = "Preview \u2014 packaged extension runs the pipeline here";
    return;
  }
  void processImage(file);
}
function showOriginalPreview(url) {
  D.dashDropZone.classList.add("hidden");
  let img = document.getElementById("dashImgOriginal");
  if (!img) {
    img = document.createElement("img");
    img.id = "dashImgOriginal";
    img.className = "viewport-img";
    img.alt = "Original image";
    D.viewportOriginal.appendChild(img);
  }
  img.src = url;
  img.classList.remove("hidden");
}
async function processImage(blob) {
  originalBlob = blob;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(blob);
  showOriginalPreview(originalUrl);
  clearOverlay();
  D.dashStatusIndicator.textContent = "Processing On-Device...";
  activeJobId = `job_${Date.now()}`;
  const options = currentPipelineOptions();
  const buffer = await blob.arrayBuffer();
  const imageBytes = Array.from(new Uint8Array(buffer));
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "RUN_PIPELINE",
      jobId: activeJobId,
      imageBytes,
      options
    });
    if (response && response.status === "SUCCESS") {
      onDashboardPipelineSuccess(response);
    } else {
      throw new Error(response && response.error || "Pipeline failed");
    }
  } catch (err) {
    D.dashStatusIndicator.textContent = "Error";
    alert("Pipeline Error: " + err.message);
  }
}
if (hasExtensionAPIs && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== "ui") return;
    if (msg.action === "CAPTION_RESULT") {
      if (msg.jobId !== activeJobId || !msg.caption) return;
      if (evidenceData && evidenceData.global_description) {
        evidenceData.global_description.caption = String(msg.caption);
        evidenceData.global_description.source = "fastvlm-caption";
      }
      D.dashCaptionText.textContent = String(msg.caption);
      return;
    }
    if (msg.action !== "PIPELINE_PROGRESS") return;
    if (msg.jobId !== activeJobId) return;
    D.dashStatusIndicator.textContent = `Running ${msg.progress.stage}...`;
  });
}
function onDashboardPipelineSuccess(response) {
  D.dashStatusIndicator.textContent = `Completed in ${response.totalTimeMs}ms`;
  const outputBase64 = response.outputBase64;
  if (!outputBase64) throw new Error("No output image from pipeline");
  const binaryStr = atob(outputBase64);
  const byteArray = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) byteArray[i] = binaryStr.charCodeAt(i);
  redactedBlob = new Blob([byteArray], { type: "image/png" });
  if (redactedUrl) URL.revokeObjectURL(redactedUrl);
  redactedUrl = URL.createObjectURL(redactedBlob);
  D.dashEmptyPlaceholder.classList.add("hidden");
  let img = document.getElementById("dashImgRedacted");
  if (!img) {
    img = document.createElement("img");
    img.id = "dashImgRedacted";
    img.className = "viewport-img";
    img.alt = "Redacted image";
    D.viewportRedacted.appendChild(img);
  }
  img.src = redactedUrl;
  img.classList.remove("hidden");
  evidenceData = response.evidence;
  renderOverlayBoxes(evidenceData && evidenceData.final_findings || [], evidenceData && evidenceData.image);
  D.dashCaptionText.textContent = evidenceData && (evidenceData.fastvlm_adjudication?.caption || evidenceData.global_description?.caption) || "No caption generated";
  D.dashJsonViewer.textContent = JSON.stringify(evidenceData, null, 2);
  D.dashPromptViewer.textContent = response.perceptionPrompt || "No prompt available";
}
function getBBoxContainer() {
  let box = document.getElementById("dashBBoxContainer");
  if (!box) {
    box = document.createElement("div");
    box.id = "dashBBoxContainer";
    box.className = "bbox-container";
    D.viewportOriginal.appendChild(box);
  }
  return box;
}
function clearOverlay() {
  const box = document.getElementById("dashBBoxContainer");
  if (box) box.innerHTML = "";
}
function renderOverlayBoxes(findings, imgMeta) {
  const container = getBBoxContainer();
  container.innerHTML = "";
  container.style.display = D.dashToggleOverlay.checked ? "block" : "none";
  if (!imgMeta || !imgMeta.width || !imgMeta.height) return;
  for (const f of findings) {
    if (!f || !f.bbox) continue;
    const [x1, y1, x2, y2] = f.bbox;
    const box = document.createElement("div");
    box.style.position = "absolute";
    box.style.border = "2px solid #ef4444";
    box.style.background = "rgba(239, 68, 68, 0.2)";
    box.style.left = `${x1 / imgMeta.width * 100}%`;
    box.style.top = `${y1 / imgMeta.height * 100}%`;
    box.style.width = `${(x2 - x1) / imgMeta.width * 100}%`;
    box.style.height = `${(y2 - y1) / imgMeta.height * 100}%`;
    box.style.boxSizing = "border-box";
    const tag = document.createElement("span");
    tag.style.position = "absolute";
    tag.style.top = "-16px";
    tag.style.left = "-2px";
    tag.style.background = "#ef4444";
    tag.style.color = "white";
    tag.style.fontSize = "9px";
    tag.style.fontWeight = "700";
    tag.style.padding = "1px 4px";
    tag.style.borderRadius = "2px";
    tag.textContent = f.entity || "PII";
    box.appendChild(tag);
    container.appendChild(box);
  }
}
D.dashToggleOverlay.addEventListener("change", () => {
  const box = document.getElementById("dashBBoxContainer");
  if (box) box.style.display = D.dashToggleOverlay.checked ? "block" : "none";
});
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const pane = document.getElementById(btn.dataset.pane);
    if (pane) pane.classList.add("active");
    void saveDashboardPrefs();
  });
});
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5e3);
}
D.dashBtnDownloadPNG.addEventListener("click", () => {
  if (!redactedBlob) {
    alert("Nothing to download yet \u2014 upload or capture an image first.");
    return;
  }
  downloadBlob(redactedBlob, `perscope_redacted_${Date.now()}.png`);
});
D.dashBtnCopy.addEventListener("click", async () => {
  if (!redactedBlob) {
    alert("Nothing to copy yet \u2014 upload or capture an image first.");
    return;
  }
  try {
    if (!(navigator.clipboard && window.ClipboardItem)) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": redactedBlob })]);
    alert("Redacted image copied to clipboard!");
  } catch (err) {
    alert("Clipboard copy error: " + err.message);
  }
});
D.dashBtnDownloadJSON.addEventListener("click", () => {
  if (!evidenceData) {
    alert("No evidence yet \u2014 upload or capture an image first.");
    return;
  }
  downloadBlob(new Blob([JSON.stringify(evidenceData, null, 2)], { type: "application/json" }), `perscope_evidence_${Date.now()}.json`);
});
var bridgeFirstPoll = true;
async function refreshBridgeStatus() {
  if (!hasExtensionAPIs) {
    D.dashBridgeStatus.textContent = "Preview mode";
    return;
  }
  if (bridgeFirstPoll) D.dashBridgeStatus.textContent = "Connecting\u2026";
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_STATUS" });
    const b = res && res.bridge;
    D.dashBridgeStatus.textContent = b && b.paired ? "Connected + paired" : b && b.connected ? "Reachable, not paired" : "Bridge not running";
    if (!D.dashBridgeMsg.dataset.sticky) D.dashBridgeMsg.textContent = "";
  } catch {
    D.dashBridgeStatus.textContent = "Bridge not running";
  } finally {
    bridgeFirstPoll = false;
  }
}
async function submitBridgePair() {
  if (!hasExtensionAPIs) {
    D.dashBridgeMsg.textContent = "Pairing needs the packaged extension.";
    return;
  }
  D.dashBridgeMsg.dataset.sticky = "1";
  D.dashBridgeMsg.textContent = "Pairing\u2026";
  try {
    const res = await chrome.runtime.sendMessage({
      target: "background",
      action: "BRIDGE_PAIR",
      code: D.dashBridgeCode && D.dashBridgeCode.value || ""
    });
    if (res && res.ok) {
      D.dashBridgeMsg.textContent = "Paired. Token stored for reconnects.";
      if (D.dashBridgeCode) D.dashBridgeCode.value = "";
    } else {
      D.dashBridgeMsg.textContent = "Pair failed: " + (res && res.reason || "unknown") + " \u2014 retry.";
    }
  } catch (err) {
    D.dashBridgeMsg.textContent = "Pair failed: " + err.message;
  } finally {
    delete D.dashBridgeMsg.dataset.sticky;
    refreshBridgeStatus();
  }
}
D.dashBridgePair.addEventListener("click", () => void submitBridgePair());
var DASH_PREFS_KEY = "perscope.dashboard.prefs";
async function saveDashboardPrefs() {
  const activeTabBtn = document.querySelector(".tab-btn.active");
  await storeSet(DASH_PREFS_KEY, {
    device: D.dashSelectDevice.selectedIndex,
    style: D.dashSelectStyle.selectedIndex,
    fastvlm: D.dashCheckFastVLM.checked,
    face: D.dashCheckFace.checked,
    tab: activeTabBtn && activeTabBtn.dataset.pane === "paneEvidence" ? "evidence" : activeTabBtn && activeTabBtn.dataset.pane === "panePrompts" ? "prompts" : "caption"
  });
}
function setTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const on = name === "evidence" && b.dataset.pane === "paneEvidence" || name === "prompts" && b.dataset.pane === "panePrompts" || name === "caption" && b.dataset.pane === "paneCaption";
    b.classList.toggle("active", on);
  });
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
  const pane = document.getElementById(name === "evidence" ? "paneEvidence" : name === "prompts" ? "panePrompts" : "paneCaption");
  if (pane) pane.classList.add("active");
}
async function restoreDashboardPrefs() {
  const prefs = await storeGet(DASH_PREFS_KEY);
  if (!prefs || typeof prefs !== "object") return;
  let deviceRestored = false;
  if (Number.isInteger(prefs.device) && D.dashSelectDevice.options[prefs.device]) {
    D.dashSelectDevice.selectedIndex = prefs.device;
    deviceRestored = true;
  }
  if (Number.isInteger(prefs.style) && D.dashSelectStyle.options[prefs.style]) {
    D.dashSelectStyle.selectedIndex = prefs.style;
  }
  D.dashCheckFastVLM.checked = prefs.fastvlm !== false;
  D.dashCheckFace.checked = prefs.face !== false;
  if (prefs.tab === "evidence" || prefs.tab === "prompts" || prefs.tab === "caption") setTab(prefs.tab);
  if (deviceRestored) initDashboardDevice();
}
[D.dashSelectDevice, D.dashSelectStyle, D.dashCheckFastVLM, D.dashCheckFace].forEach((el) => {
  el.addEventListener("change", () => {
    void saveDashboardPrefs();
    if (el === D.dashSelectDevice) initDashboardDevice();
  });
});
(async function init() {
  const storedTheme = await storeGet("perscope-theme");
  let theme = storedTheme;
  if (theme !== "light" && theme !== "dark") {
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      theme = "light";
    }
  }
  applyTheme(theme, false);
  D.dashStatusIndicator.textContent = DEFAULT_STATUS;
  await restoreDashboardPrefs();
  await initDashboardDevice();
  await refreshBridgeStatus();
  if (hasExtensionAPIs) {
    setInterval(refreshBridgeStatus, 5e3);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshBridgeStatus();
    });
  }
})();
globalThis.__PERSCOPE_BUILD = { "commit": "d8072c4", "time": "2026-09-28T17:26:47.256Z" };
;globalThis.__PERSCOPE_BUILD={"commit":"cf88751","time":"2026-09-29T18:55:43.197Z"};
