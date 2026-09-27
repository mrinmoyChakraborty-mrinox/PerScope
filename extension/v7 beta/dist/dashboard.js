// src/app/dashboard.js
var originalBlob = null;
var originalUrl = null;
var redactedBlob = null;
var redactedUrl = null;
var evidenceData = null;
var activeJobId = null;
var D = {
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
  dashTitle: document.getElementById("dashTitle"),
  dashStatusIndicator: document.getElementById("dashStatusIndicator"),
  dashResultsActions: document.getElementById("dashResultsActions"),
  dashBtnDownloadPNG: document.getElementById("dashBtnDownloadPNG"),
  dashBtnCopy: document.getElementById("dashBtnCopy"),
  dashBtnDownloadJSON: document.getElementById("dashBtnDownloadJSON"),
  dashToggleOverlay: document.getElementById("dashToggleOverlay"),
  dashImgOriginal: document.getElementById("dashImgOriginal"),
  dashBBoxContainer: document.getElementById("dashBBoxContainer"),
  dashEmptyPlaceholder: document.getElementById("dashEmptyPlaceholder"),
  dashImgRedacted: document.getElementById("dashImgRedacted"),
  tabBtnCaption: document.getElementById("tabBtnCaption"),
  tabBtnEvidence: document.getElementById("tabBtnEvidence"),
  tabBtnPrompts: document.getElementById("tabBtnPrompts"),
  paneCaption: document.getElementById("paneCaption"),
  paneEvidence: document.getElementById("paneEvidence"),
  panePrompts: document.getElementById("panePrompts"),
  dashCaptionText: document.getElementById("dashCaptionText"),
  dashJsonViewer: document.getElementById("dashJsonViewer"),
  dashPromptViewer: document.getElementById("dashPromptViewer")
};
async function initDashboardDevice() {
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "GET_DEVICE_INFO",
      forceTier: D.dashSelectDevice.value === "auto" ? null : D.dashSelectDevice.value
    });
    if (res?.device) {
      updateDeviceTelemetry(res.device);
    }
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
  if (tier === "dedicated") {
    D.dashDeviceTier.style.color = "#34d399";
    D.dashDeviceTier.style.background = "rgba(16, 185, 129, 0.15)";
    D.dashPulseDot.style.background = "#10b981";
  } else if (tier === "integrated") {
    D.dashDeviceTier.style.color = "#22d3ee";
    D.dashDeviceTier.style.background = "rgba(6, 182, 212, 0.15)";
    D.dashPulseDot.style.background = "#06b6d4";
  } else {
    D.dashDeviceTier.style.color = "#fbbf24";
    D.dashDeviceTier.style.background = "rgba(245, 158, 11, 0.15)";
    D.dashPulseDot.style.background = "#f59e0b";
  }
}
D.dashBtnUpload.addEventListener("click", () => D.dashFileInput.click());
D.dashDropZone.addEventListener("click", () => D.dashFileInput.click());
D.dashFileInput.addEventListener("change", () => {
  if (D.dashFileInput.files.length) processImage(D.dashFileInput.files[0]);
});
D.dashDropZone.addEventListener("dragover", (e) => e.preventDefault());
D.dashDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) processImage(e.dataTransfer.files[0]);
});
D.dashBtnCapture.addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "CAPTURE_VISIBLE_TAB" });
    if (res?.dataUrl) {
      const blob = await (await fetch(res.dataUrl)).blob();
      processImage(blob);
    }
  } catch (err) {
    alert("Capture failed: " + err.message);
  }
});
async function processImage(blob) {
  originalBlob = blob;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(blob);
  D.dashImgOriginal.src = originalUrl;
  D.dashImgOriginal.classList.remove("hidden");
  D.dashDropZone.classList.add("hidden");
  D.dashStatusIndicator.textContent = "Processing On-Device...";
  D.dashStatusIndicator.style.background = "rgba(59, 130, 246, 0.2)";
  D.dashStatusIndicator.style.color = "#60a5fa";
  activeJobId = `job_${Date.now()}`;
  const options = {
    forceDeviceTier: D.dashSelectDevice.value === "auto" ? null : D.dashSelectDevice.value,
    redactionStyle: D.dashSelectStyle.value,
    fastvlmEnabled: D.dashCheckFastVLM.checked,
    faceEnabled: D.dashCheckFace.checked
  };
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
    if (response?.status === "SUCCESS") {
      onDashboardPipelineSuccess(response);
    } else {
      throw new Error(response?.error || "Pipeline failed");
    }
  } catch (err) {
    D.dashStatusIndicator.textContent = "Error";
    D.dashStatusIndicator.style.color = "#ef4444";
    alert("Pipeline Error: " + err.message);
  }
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "ui" || msg.action !== "PIPELINE_PROGRESS") return;
  if (msg.jobId !== activeJobId) return;
  D.dashStatusIndicator.textContent = `Running ${msg.progress.stage}...`;
});
function onDashboardPipelineSuccess(response) {
  D.dashStatusIndicator.textContent = `Completed in ${response.totalTimeMs}ms`;
  D.dashStatusIndicator.style.background = "rgba(16, 185, 129, 0.2)";
  D.dashStatusIndicator.style.color = "#34d399";
  D.dashResultsActions.style.display = "flex";
  const outputBase64 = response.outputBase64;
  if (!outputBase64) throw new Error("No output image from pipeline");
  const binaryStr = atob(outputBase64);
  const byteArray = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) byteArray[i] = binaryStr.charCodeAt(i);
  redactedBlob = new Blob([byteArray], { type: "image/png" });
  if (redactedUrl) URL.revokeObjectURL(redactedUrl);
  redactedUrl = URL.createObjectURL(redactedBlob);
  D.dashImgRedacted.src = redactedUrl;
  D.dashImgRedacted.classList.remove("hidden");
  D.dashEmptyPlaceholder.classList.add("hidden");
  evidenceData = response.evidence;
  renderOverlayBoxes(response.evidence?.final_findings || [], response.evidence?.image);
  D.dashCaptionText.textContent = response.evidence?.fastvlm_adjudication?.caption || response.evidence?.global_description?.caption || "No caption generated";
  D.dashJsonViewer.textContent = JSON.stringify(response.evidence, null, 2);
  D.dashPromptViewer.textContent = response.perceptionPrompt || "No prompt available";
}
function renderOverlayBoxes(findings, imgMeta) {
  D.dashBBoxContainer.innerHTML = "";
  if (!imgMeta?.width || !imgMeta?.height) return;
  for (const f of findings) {
    if (!f.bbox) continue;
    const [x1, y1, x2, y2] = f.bbox;
    const leftPct = x1 / imgMeta.width * 100;
    const topPct = y1 / imgMeta.height * 100;
    const widthPct = (x2 - x1) / imgMeta.width * 100;
    const heightPct = (y2 - y1) / imgMeta.height * 100;
    const box = document.createElement("div");
    box.style.position = "absolute";
    box.style.border = "2px solid #ef4444";
    box.style.background = "rgba(239, 68, 68, 0.2)";
    box.style.left = `${leftPct}%`;
    box.style.top = `${topPct}%`;
    box.style.width = `${widthPct}%`;
    box.style.height = `${heightPct}%`;
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
    D.dashBBoxContainer.appendChild(box);
  }
}
D.dashToggleOverlay.addEventListener("change", () => {
  D.dashBBoxContainer.style.display = D.dashToggleOverlay.checked ? "block" : "none";
});
function setTab(activeTab) {
  D.tabBtnCaption.classList.toggle("active", activeTab === "caption");
  D.tabBtnEvidence.classList.toggle("active", activeTab === "evidence");
  D.tabBtnPrompts.classList.toggle("active", activeTab === "prompts");
  D.paneCaption.classList.toggle("active", activeTab === "caption");
  D.paneEvidence.classList.toggle("active", activeTab === "evidence");
  D.panePrompts.classList.toggle("active", activeTab === "prompts");
}
D.tabBtnCaption.addEventListener("click", () => setTab("caption"));
D.tabBtnEvidence.addEventListener("click", () => setTab("evidence"));
D.tabBtnPrompts.addEventListener("click", () => setTab("prompts"));
D.dashBtnDownloadPNG.addEventListener("click", () => {
  if (!redactedBlob) return;
  const a = document.createElement("a");
  a.href = redactedUrl;
  a.download = `perscope_redacted_${Date.now()}.png`;
  a.click();
});
D.dashBtnCopy.addEventListener("click", async () => {
  if (!redactedBlob) return;
  await navigator.clipboard.write([new ClipboardItem({ "image/png": redactedBlob })]);
  alert("Redacted image copied to clipboard!");
});
D.dashBtnDownloadJSON.addEventListener("click", () => {
  if (!evidenceData) return;
  const str = JSON.stringify(evidenceData, null, 2);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `perscope_evidence_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
initDashboardDevice();
var bridgeFirstPoll = true;
async function refreshBridgeStatus() {
  const el = document.getElementById("dashBridgeStatus");
  const msg = document.getElementById("dashBridgeMsg");
  if (bridgeFirstPoll && el) el.textContent = "Connecting\u2026";
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_STATUS" });
    const b = res?.bridge;
    if (el) el.textContent = b?.paired ? "Connected + paired" : b?.connected ? "Reachable, not paired" : "Bridge not running";
    if (msg && !msg.dataset.sticky) msg.textContent = "";
  } catch {
    if (el) el.textContent = "Bridge not running";
  } finally {
    bridgeFirstPoll = false;
  }
}
async function submitBridgePair() {
  const codeEl = document.getElementById("dashBridgeCode");
  const msg = document.getElementById("dashBridgeMsg");
  if (msg) {
    msg.dataset.sticky = "1";
    msg.textContent = "Pairing\uFFFD";
  }
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_PAIR", code: codeEl?.value || "" });
    if (res?.ok) {
      if (msg) msg.textContent = "Paired. Token stored for reconnects.";
      if (codeEl) codeEl.value = "";
    } else {
      if (msg) msg.textContent = "Pair failed: " + (res?.reason || "unknown") + " \uFFFD retry.";
    }
  } catch (err) {
    if (msg) msg.textContent = "Pair failed: " + err.message;
  } finally {
    if (msg) delete msg.dataset.sticky;
    refreshBridgeStatus();
  }
}
document.getElementById("dashBridgePair")?.addEventListener("click", submitBridgePair);
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 5e3);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshBridgeStatus();
});
var DASH_PREFS_KEY = "perscope.dashboard.prefs";
async function saveDashboardPrefs() {
  try {
    await chrome.storage.local.set({
      [DASH_PREFS_KEY]: {
        device: D.dashSelectDevice?.value || "auto",
        style: D.dashSelectStyle?.value || null,
        fastvlm: !!D.dashCheckFastVLM?.checked,
        face: !!D.dashCheckFace?.checked,
        tab: D.tabBtnEvidence?.classList.contains("active") ? "evidence" : D.tabBtnPrompts?.classList.contains("active") ? "prompts" : "caption"
      }
    });
  } catch {
  }
}
async function restoreDashboardPrefs() {
  try {
    const stored = await chrome.storage.local.get([DASH_PREFS_KEY]);
    const prefs = stored?.[DASH_PREFS_KEY];
    if (!prefs || typeof prefs !== "object") return;
    let deviceRestored = false;
    if (D.dashSelectDevice && typeof prefs.device === "string") {
      D.dashSelectDevice.value = prefs.device;
      deviceRestored = true;
    }
    if (D.dashSelectStyle && typeof prefs.style === "string") D.dashSelectStyle.value = prefs.style;
    if (D.dashCheckFastVLM) D.dashCheckFastVLM.checked = prefs.fastvlm !== false;
    if (D.dashCheckFace) D.dashCheckFace.checked = prefs.face !== false;
    if (prefs.tab === "evidence" || prefs.tab === "prompts" || prefs.tab === "caption") setTab(prefs.tab);
    if (deviceRestored) initDashboardDevice();
  } catch {
  }
}
[D.dashSelectDevice, D.dashSelectStyle, D.dashCheckFastVLM, D.dashCheckFace].forEach((el) => {
  el?.addEventListener("change", () => {
    saveDashboardPrefs();
    if (el === D.dashSelectDevice) initDashboardDevice();
  });
});
[D.tabBtnCaption, D.tabBtnEvidence, D.tabBtnPrompts].forEach((el) => {
  el?.addEventListener("click", () => saveDashboardPrefs());
});
restoreDashboardPrefs();
