/**
 * PerScope Popup UI Logic
 */

let originalImageBlob = null;
let originalImageUrl = null;
let redactedImageBlob = null;
let redactedImageUrl = null;
let currentEvidence = null;
let currentDevice = null;
let activeJobId = null;

const UI = {
  gpuIndicator: document.getElementById("gpuIndicator"),
  gpuDeviceLabel: document.getElementById("gpuDeviceLabel"),
  gpuTierBadge: document.getElementById("gpuTierBadge"),
  btnToggleSettings: document.getElementById("btnToggleSettings"),
  settingsPanel: document.getElementById("settingsPanel"),
  selectDeviceTier: document.getElementById("selectDeviceTier"),
  selectRedactionStyle: document.getElementById("selectRedactionStyle"),
  checkFastVLM: document.getElementById("checkFastVLM"),
  checkFaceDetection: document.getElementById("checkFaceDetection"),
  btnOpenDashboard: document.getElementById("btnOpenDashboard"),

  inputSection: document.getElementById("inputSection"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  btnBrowse: document.getElementById("btnBrowse"),
  btnCaptureTab: document.getElementById("btnCaptureTab"),

  processingSection: document.getElementById("processingSection"),
  currentStageTitle: document.getElementById("currentStageTitle"),
  currentStageDetail: document.getElementById("currentStageDetail"),
  stepOCR: document.getElementById("stepOCR"),
  stepNER: document.getElementById("stepNER"),
  stepFace: document.getElementById("stepFace"),
  stepFastVLM: document.getElementById("stepFastVLM"),
  stepRedact: document.getElementById("stepRedact"),

  resultsSection: document.getElementById("resultsSection"),
  btnViewRedacted: document.getElementById("btnViewRedacted"),
  btnViewOriginal: document.getElementById("btnViewOriginal"),
  btnViewOverlay: document.getElementById("btnViewOverlay"),
  btnReset: document.getElementById("btnReset"),
  resultImage: document.getElementById("resultImage"),
  bboxOverlay: document.getElementById("bboxOverlay"),
  captionCard: document.getElementById("captionCard"),
  captionText: document.getElementById("captionText"),
  statTextRedacted: document.getElementById("statTextRedacted"),
  statFacesRedacted: document.getElementById("statFacesRedacted"),
  statTotalTime: document.getElementById("statTotalTime"),
  btnDownloadImage: document.getElementById("btnDownloadImage"),
  btnCopyClipboard: document.getElementById("btnCopyClipboard"),
  btnDownloadEvidence: document.getElementById("btnDownloadEvidence"),
};

// Initialize device detection
async function initDeviceStatus() {
  try {
    // Ensure offscreen document is alive
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });

    // Request device info from offscreen host
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "GET_DEVICE_INFO",
      forceTier: UI.selectDeviceTier.value === "auto" ? null : UI.selectDeviceTier.value,
    });

    if (res?.device) {
      currentDevice = res.device;
      updateHardwareBadge(res.device);
    }
  } catch (e) {
    console.warn("Device detection error:", e);
    updateHardwareBadge({ tier: "cpu", label: "CPU (Fallback)" });
  }
}

function updateHardwareBadge(device) {
  const tier = device.tier || "cpu";
  UI.gpuDeviceLabel.textContent = device.label || device.description || "Hardware Accelerator";
  UI.gpuIndicator.className = `hardware-indicator ${tier}`;
  UI.gpuTierBadge.className = `hardware-tier-badge ${tier}`;
  UI.gpuTierBadge.textContent = tier.toUpperCase();
}

// Settings Toggle
UI.btnToggleSettings.addEventListener("click", () => {
  UI.settingsPanel.classList.toggle("hidden");
});

UI.selectDeviceTier.addEventListener("change", () => {
  initDeviceStatus();
});

UI.btnOpenDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// File Drop & Select
UI.btnBrowse.addEventListener("click", () => UI.fileInput.click());
UI.dropZone.addEventListener("click", (e) => {
  if (e.target !== UI.btnBrowse) UI.fileInput.click();
});

UI.dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  UI.dropZone.classList.add("dragover");
});

UI.dropZone.addEventListener("dragleave", () => {
  UI.dropZone.classList.remove("dragover");
});

UI.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  UI.dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    handleImageFile(e.dataTransfer.files[0]);
  }
});

UI.fileInput.addEventListener("change", () => {
  if (UI.fileInput.files.length) {
    handleImageFile(UI.fileInput.files[0]);
  }
});

// Clipboard paste
window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        handleImageFile(file);
        break;
      }
    }
  }
});

// Tab Capture
UI.btnCaptureTab.addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({
      target: "background",
      action: "CAPTURE_VISIBLE_TAB",
    });
    if (res?.dataUrl) {
      const blobRes = await fetch(res.dataUrl);
      const blob = await blobRes.blob();
      handleImageFile(blob);
    } else if (res?.error) {
      alert("Tab capture error: " + res.error);
    }
  } catch (err) {
    alert("Capture failed: " + err.message);
  }
});

async function handleImageFile(blob) {
  originalImageBlob = blob;
  if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
  originalImageUrl = URL.createObjectURL(blob);

  // Show processing section
  UI.inputSection.classList.add("hidden");
  UI.resultsSection.classList.add("hidden");
  UI.processingSection.classList.remove("hidden");
  resetStepper();

  activeJobId = `job_${Date.now()}`;
  const options = {
    forceDeviceTier: UI.selectDeviceTier.value === "auto" ? null : UI.selectDeviceTier.value,
    redactionStyle: UI.selectRedactionStyle.value,
    fastvlmEnabled: UI.checkFastVLM.checked,
    faceEnabled: UI.checkFaceDetection.checked,
  };

  const buffer = await blob.arrayBuffer();
  // Send as a plain Array<number> — structured clone handles this without
  // the GC pressure of a 1M-element JSON-serialised number array.
  // The Uint8Array spread is just a compact way to get the bytes.
  const imageBytes = Array.from(new Uint8Array(buffer));

  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });

    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "RUN_PIPELINE",
      jobId: activeJobId,
      imageBytes,
      options,
    });

    if (response?.status === "SUCCESS") {
      onPipelineComplete(response);
    } else {
      throw new Error(response?.error || "Pipeline failed");
    }
  } catch (err) {
    alert("Pipeline Error: " + err.message);
    resetToInput();
  }
}

// Progress Stepper Updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "ui" || message.action !== "PIPELINE_PROGRESS") return;
  if (message.jobId !== activeJobId) return;

  const { stage, status, ...extra } = message.progress;
  updateStepper(stage, status, extra);
});

function resetStepper() {
  const steps = [UI.stepOCR, UI.stepNER, UI.stepFace, UI.stepFastVLM, UI.stepRedact];
  steps.forEach((s) => (s.className = "step-item"));
}

function updateStepper(stage, status, extra) {
  const map = {
    OCR: UI.stepOCR,
    NER: UI.stepNER,
    FACE: UI.stepFace,
    FASTVLM: UI.stepFastVLM,
    REDACT: UI.stepRedact,
  };

  if (stage === "OCR") {
    UI.currentStageTitle.textContent = "Scanning Text Lines...";
    UI.currentStageDetail.textContent = "Running PaddleOCR PP-OCRv6 small model";
    UI.stepOCR.className = "step-item active";
  } else if (stage === "NER") {
    UI.stepOCR.className = "step-item done";
    UI.stepNER.className = "step-item active";
    UI.currentStageTitle.textContent = "Extracting PII Entities...";
    UI.currentStageDetail.textContent = "Running Ettin-68M Token Classification";
  } else if (stage === "FACE") {
    UI.stepFace.className = "step-item active";
    UI.currentStageTitle.textContent = "Detecting Human Faces...";
    UI.currentStageDetail.textContent = "Running BlazeFace 128x128 ONNX Detector";
  } else if (stage === "FASTVLM") {
    UI.stepNER.className = "step-item done";
    UI.stepFace.className = "step-item done";
    UI.stepFastVLM.className = "step-item active";
    UI.currentStageTitle.textContent = "FastVLM 0.5B Multimodal Adjudication...";
    UI.currentStageDetail.textContent = "Visual reasoning and privacy validation on dedicated GPU";
  } else if (stage === "REDACT") {
    UI.stepFastVLM.className = "step-item done";
    UI.stepRedact.className = "step-item active";
    UI.currentStageTitle.textContent = "Redacting Image On-Device...";
    UI.currentStageDetail.textContent = "Applying hardware-accelerated OffscreenCanvas filters";
  }
}

function onPipelineComplete(response) {
  UI.processingSection.classList.add("hidden");
  UI.resultsSection.classList.remove("hidden");

  // Reconstruct redacted image blob from base64 (avoids the huge number-array round-trip)
  const outputBase64 = response.outputBase64;
  if (!outputBase64) throw new Error("No output image from pipeline");
  const binaryStr = atob(outputBase64);
  const byteArray = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) byteArray[i] = binaryStr.charCodeAt(i);
  redactedImageBlob = new Blob([byteArray], { type: "image/png" });
  if (redactedImageUrl) URL.revokeObjectURL(redactedImageUrl);
  redactedImageUrl = URL.createObjectURL(redactedImageBlob);

  currentEvidence = response.evidence;

  // Set image source
  UI.resultImage.src = redactedImageUrl;
  setViewMode("redacted");

  // Populate Caption
  const caption =
    response.evidence?.fastvlm_adjudication?.caption ||
    response.evidence?.global_description?.caption ||
    "No multimodal caption generated";
  UI.captionText.textContent = caption;

  // Populate Stats
  UI.statTextRedacted.textContent = response.evidence?.image_redaction?.textRegionsRedacted ?? 0;
  UI.statFacesRedacted.textContent = response.evidence?.image_redaction?.faceRegionsRedacted ?? response.evidence?.face_detection?.count ?? 0;
  UI.statTotalTime.textContent = `${response.totalTimeMs} ms`;

  // Populate BBoxes for overlay view
  renderBBoxOverlay(response.evidence?.final_findings || [], response.evidence?.image);
}

function renderBBoxOverlay(findings, imgMeta) {
  UI.bboxOverlay.innerHTML = "";
  if (!imgMeta?.width || !imgMeta?.height) return;

  for (const f of findings) {
    if (!f.bbox) continue;
    const [x1, y1, x2, y2] = f.bbox;
    const leftPct = (x1 / imgMeta.width) * 100;
    const topPct = (y1 / imgMeta.height) * 100;
    const widthPct = ((x2 - x1) / imgMeta.width) * 100;
    const heightPct = ((y2 - y1) / imgMeta.height) * 100;

    const box = document.createElement("div");
    box.className = "bbox-box";
    box.style.left = `${leftPct}%`;
    box.style.top = `${topPct}%`;
    box.style.width = `${widthPct}%`;
    box.style.height = `${heightPct}%`;

    const tag = document.createElement("span");
    tag.className = "bbox-tag";
    tag.textContent = f.entity || "PII";
    box.appendChild(tag);

    UI.bboxOverlay.appendChild(box);
  }
}

function setViewMode(mode) {
  UI.btnViewRedacted.classList.toggle("active", mode === "redacted");
  UI.btnViewOriginal.classList.toggle("active", mode === "original");
  UI.btnViewOverlay.classList.toggle("active", mode === "overlay");

  if (mode === "redacted") {
    UI.resultImage.src = redactedImageUrl;
    UI.bboxOverlay.classList.add("hidden");
  } else if (mode === "original") {
    UI.resultImage.src = originalImageUrl;
    UI.bboxOverlay.classList.add("hidden");
  } else if (mode === "overlay") {
    UI.resultImage.src = originalImageUrl;
    UI.bboxOverlay.classList.remove("hidden");
  }
}

UI.btnViewRedacted.addEventListener("click", () => setViewMode("redacted"));
UI.btnViewOriginal.addEventListener("click", () => setViewMode("original"));
UI.btnViewOverlay.addEventListener("click", () => setViewMode("overlay"));

// Reset
function resetToInput() {
  UI.processingSection.classList.add("hidden");
  UI.resultsSection.classList.add("hidden");
  UI.inputSection.classList.remove("hidden");
  UI.fileInput.value = "";
}

UI.btnReset.addEventListener("click", resetToInput);

// Downloads & Copy
UI.btnDownloadImage.addEventListener("click", () => {
  if (!redactedImageBlob) return;
  const a = document.createElement("a");
  a.href = redactedImageUrl;
  a.download = `perscope_redacted_${Date.now()}.png`;
  a.click();
});

UI.btnCopyClipboard.addEventListener("click", async () => {
  if (!redactedImageBlob) return;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": redactedImageBlob }),
    ]);
    const oldText = UI.btnCopyClipboard.textContent;
    UI.btnCopyClipboard.textContent = "Copied!";
    setTimeout(() => (UI.btnCopyClipboard.textContent = oldText), 1500);
  } catch (err) {
    alert("Clipboard copy error: " + err.message);
  }
});

UI.btnDownloadEvidence.addEventListener("click", () => {
  if (!currentEvidence) return;
  const str = JSON.stringify(currentEvidence, null, 2);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `perscope_evidence_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Startup
initDeviceStatus();
