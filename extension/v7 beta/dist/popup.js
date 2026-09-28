// src/popup/popup.js
var hasExtensionAPIs = typeof chrome !== "undefined" && !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
var hasTabsAPI = hasExtensionAPIs && !!(chrome.tabs && chrome.tabs.create);
var hasStorageAPI = hasExtensionAPIs && !!(chrome.storage && chrome.storage.local);
function localGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}
function localSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
  }
}
async function storeGet(keys) {
  if (hasStorageAPI) {
    try {
      return await chrome.storage.local.get(keys);
    } catch {
    }
  }
  const out = {};
  for (const k of Object.keys(keys)) {
    const raw = localGet(k, null);
    out[k] = raw === null ? keys[k] : JSON.parse(raw);
  }
  return out;
}
async function storeSet(obj) {
  if (hasStorageAPI) {
    try {
      await chrome.storage.local.set(obj);
      return;
    } catch {
    }
  }
  for (const [k, v] of Object.entries(obj)) localSet(k, JSON.stringify(v));
}
var shell = document.getElementById("popupShell");
var themeIcon = document.getElementById("themeIcon");
var processingCard = document.getElementById("processingCard");
var processingLabel = document.getElementById("processingLabel");
var stepEls = [...document.querySelectorAll("#stepsProgress .step-item")];
var stageLabels = ["Capturing\u2026", "Extracting\u2026", "Detecting sensitive info\u2026", "Sanitizing\u2026"];
var reviewSection = document.getElementById("reviewSection");
var imageResultBlock = document.getElementById("imageResultBlock");
var textResultBlock = document.getElementById("textResultBlock");
var copyImageRow = document.getElementById("copyImageRow");
var mockBrowser = document.getElementById("mockBrowser");
var mockBody = document.getElementById("mockBody");
var realImageWrap = document.getElementById("realImageWrap");
var realImage = document.getElementById("realImage");
var captureSourceNote = document.getElementById("captureSourceNote");
var btnVisual = document.getElementById("btnViewVisual");
var btnContext = document.getElementById("btnViewContext");
var contextBlock = document.getElementById("contextBlock");
var defaultContextHTML = contextBlock.innerHTML;
var textInputCard = document.getElementById("textInputCard");
var textCaptureInput = document.getElementById("textCaptureInput");
var textOutputCard = document.getElementById("textOutputCard");
var sanitizedTextOutput = document.getElementById("sanitizedTextOutput");
var textStatsGrid = document.getElementById("textStatsGrid");
var statTextFindings = document.getElementById("statTextFindings");
var statTextChars = document.getElementById("statTextChars");
var headerBadge = document.getElementById("headerBadge");
var headerBadgeText = document.getElementById("headerBadgeText");
var statusIcon = document.getElementById("statusIcon");
var statusTitle = document.getElementById("statusTitle");
var statusSubtitle = document.getElementById("statusSubtitle");
var badgeList = document.getElementById("badgeList");
var defaultBadgeHTML = badgeList.innerHTML;
var defaultStatusTitle = statusTitle.textContent;
var defaultStatusSubtitle = statusSubtitle.textContent;
var btnSend = document.getElementById("btnSend");
var btnSendLabel = document.getElementById("btnSendLabel");
var helperNote = document.getElementById("helperNote");
var defaultHelperNote = helperNote.textContent;
var bboxToggle = document.getElementById("bboxToggle");
var fileInput = document.getElementById("fileInput");
var captureModalBackdrop = document.getElementById("captureModalBackdrop");
var selectDeviceTier = document.getElementById("selectDeviceTier");
var selectRedactionStyle = document.getElementById("selectRedactionStyle");
var checkFastVLM = document.getElementById("checkFastVLM");
var checkFaceDetection = document.getElementById("checkFaceDetection");
var deviceNote = document.getElementById("deviceNote");
var footerDeviceItem = document.getElementById("footerDeviceItem");
var originalImageBlob = null;
var originalImageUrl = null;
var redactedImageBlob = null;
var redactedImageUrl = null;
var currentEvidence = null;
var currentCaption = "";
var currentDevice = null;
var currentBridge = null;
var activeJobId = null;
var usingRealImage = false;
var currentRealBoxes = [];
var contextViewed = false;
var currentState = "protected";
var liveBadges = false;
var capturedSelectionText = "";
var ICON_SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
var ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';
function applyTheme(t, persist = true) {
  shell.setAttribute("data-theme", t);
  themeIcon.innerHTML = t === "dark" ? ICON_MOON : ICON_SUN;
  if (persist) void storeSet({ "perscope-theme": t });
}
document.getElementById("btnTheme").addEventListener("click", () => {
  applyTheme(shell.getAttribute("data-theme") === "light" ? "dark" : "light");
});
var advToggle = document.getElementById("advancedToggle");
var advBody = document.getElementById("advancedBody");
function toggleAdvanced(force) {
  const open = force !== void 0 ? force : !advBody.classList.contains("open");
  advBody.classList.toggle("open", open);
  advToggle.classList.toggle("open", open);
}
advToggle.addEventListener("click", () => toggleAdvanced());
document.getElementById("btnAdvancedFromGear").addEventListener("click", () => toggleAdvanced(true));
function getForceTier() {
  const v = selectDeviceTier.value || "";
  if (v.startsWith("Integrated")) return "integrated";
  if (v.startsWith("CPU")) return "cpu";
  return null;
}
function getRedactionStyle() {
  return (selectRedactionStyle.value || "").startsWith("Black") ? "black" : "blur";
}
function currentPipelineOptions() {
  return {
    forceDeviceTier: getForceTier(),
    redactionStyle: getRedactionStyle(),
    fastvlmEnabled: checkFastVLM.checked,
    faceEnabled: checkFaceDetection.checked
  };
}
function persistSettings() {
  return storeSet({
    "perscope-popup-settings": {
      deviceTier: selectDeviceTier.selectedIndex,
      redactionStyle: selectRedactionStyle.selectedIndex,
      fastvlm: checkFastVLM.checked,
      face: checkFaceDetection.checked,
      dest: getSelectedDest()
    }
  });
}
selectDeviceTier.addEventListener("change", () => {
  void persistSettings();
  void initDeviceStatus();
});
selectRedactionStyle.addEventListener("change", () => void persistSettings());
checkFastVLM.addEventListener("change", () => void persistSettings());
checkFaceDetection.addEventListener("change", () => void persistSettings());
function refreshStatusTooltips() {
  const deviceBits = currentDevice ? `On-device inference: ${currentDevice.label || currentDevice.description || currentDevice.tier} (${String(currentDevice.tier || "cpu").toUpperCase()})` : "On-device inference: detecting hardware\u2026";
  const bridgeBits = currentBridge ? `Bridge: ${currentBridge.paired ? "connected + paired" : currentBridge.connected ? "reachable, not paired" : "not running"}` : "Bridge: checking\u2026";
  const tip = `${deviceBits}. ${bridgeBits}. Everything stays on this device.`;
  deviceNote.title = tip;
  footerDeviceItem.title = tip;
}
async function initDeviceStatus() {
  refreshStatusTooltips();
  if (!hasExtensionAPIs) {
    deviceNote.title = "Preview mode \u2014 the packaged extension runs this pipeline fully on-device.";
    return;
  }
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "GET_DEVICE_INFO",
      forceTier: getForceTier()
    });
    if (res && res.device) currentDevice = res.device;
  } catch (e) {
    console.warn("Device detection error:", e);
    currentDevice = { tier: "cpu", label: "CPU (Fallback)" };
  }
  refreshStatusTooltips();
}
async function refreshBridgeStatus() {
  if (!hasExtensionAPIs) return;
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", action: "BRIDGE_STATUS" });
    if (res && res.bridge) currentBridge = res.bridge;
  } catch {
    currentBridge = { connected: false, paired: false };
  }
  refreshStatusTooltips();
}
function showProcessing(label) {
  reviewSection.classList.remove("active");
  processingCard.classList.add("active");
  stepEls.forEach((s) => s.classList.remove("done", "current"));
  processingLabel.textContent = label || stageLabels[0];
}
function markStep(i) {
  stepEls.forEach((s, idx) => {
    s.classList.toggle("done", idx < i);
    s.classList.toggle("current", idx === i);
  });
  if (stageLabels[i]) processingLabel.textContent = stageLabels[i];
}
function hideProcessing() {
  processingCard.classList.remove("active");
}
function runSimulatedSteps(onDone) {
  showProcessing();
  let i = 0;
  (function nextStep() {
    if (i > 0) {
      stepEls[i - 1].classList.remove("current");
      stepEls[i - 1].classList.add("done");
    }
    if (i < stepEls.length) {
      stepEls[i].classList.add("current");
      processingLabel.textContent = stageLabels[i];
      i++;
      setTimeout(nextStep, 420);
    } else {
      hideProcessing();
      reviewSection.classList.add("active");
      if (onDone) onDone();
    }
  })();
}
if (hasExtensionAPIs && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== "ui" || message.action !== "PIPELINE_PROGRESS") return;
    if (message.jobId !== activeJobId) return;
    const stage = message.progress && message.progress.stage;
    const map = { OCR: 0, NER: 1, FACE: 2, FASTVLM: 2, REDACT: 3 };
    if (stage && map[stage] !== void 0) markStep(map[stage]);
  });
}
function isImageFile(file) {
  return !!file && !!file.type && file.type.startsWith("image/");
}
function loadImageFile(file, sourceLabel) {
  if (!isImageFile(file)) {
    alert("That file isn\u2019t an image \u2014 pick a PNG, JPG or WebP.");
    return;
  }
  imageResultBlock.style.display = "";
  textResultBlock.style.display = "none";
  copyImageRow.style.display = "";
  void runImagePipeline(file, `${sourceLabel}: ${file.name || "image"}`);
}
document.getElementById("btnUpload").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) loadImageFile(file, "Uploaded");
  fileInput.value = "";
});
async function handlePasteClick() {
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          loadImageFile(new File([blob], "clipboard-image.png", { type }), "Pasted");
          return;
        }
      }
      alert("No image found on your clipboard. Copy an image first, or press Ctrl+V here.");
    } catch {
      alert("Clipboard access needs your permission. Click inside the popup and press Ctrl+V instead.");
    }
  } else {
    alert("Press Ctrl+V to paste an image here.");
  }
}
document.getElementById("btnPaste").addEventListener("click", handlePasteClick);
document.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) loadImageFile(file, "Pasted");
      e.preventDefault();
      return;
    }
  }
});
async function captureVisibleTabImage() {
  const res = await chrome.runtime.sendMessage({ target: "background", action: "CAPTURE_VISIBLE_TAB" });
  if (res && res.dataUrl) {
    const blobRes = await fetch(res.dataUrl);
    return await blobRes.blob();
  }
  throw new Error(res && res.error || "Tab capture failed");
}
async function acquirePreviewImageBlob() {
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((resolve) => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = resolve;
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } catch {
      return null;
    }
  }
  return null;
}
async function runImagePipeline(blob, sourceLabel) {
  originalImageBlob = blob;
  if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
  originalImageUrl = URL.createObjectURL(blob);
  if (!hasExtensionAPIs) {
    runSimulatedSteps(() => showMockImage());
    return;
  }
  showProcessing("Capturing page\u2026");
  markStep(0);
  activeJobId = `job_${Date.now()}`;
  const options = currentPipelineOptions();
  try {
    const buffer = await blob.arrayBuffer();
    const imageBytes = Array.from(new Uint8Array(buffer));
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "RUN_PIPELINE",
      jobId: activeJobId,
      imageBytes,
      options
    });
    if (response && response.status === "SUCCESS") {
      onPipelineComplete(response, sourceLabel);
    } else {
      throw new Error(response && response.error || "Pipeline failed");
    }
  } catch (err) {
    alert("Pipeline Error: " + err.message);
    resetView();
  }
}
function onPipelineComplete(response, sourceLabel) {
  const outputBase64 = response.outputBase64;
  if (!outputBase64) throw new Error("No output image from pipeline");
  const binaryStr = atob(outputBase64);
  const byteArray = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) byteArray[i] = binaryStr.charCodeAt(i);
  redactedImageBlob = new Blob([byteArray], { type: "image/png" });
  if (redactedImageUrl) URL.revokeObjectURL(redactedImageUrl);
  redactedImageUrl = URL.createObjectURL(redactedImageBlob);
  currentEvidence = response.evidence || null;
  currentCaption = String(
    currentEvidence && (currentEvidence.fastvlm_adjudication?.caption || currentEvidence.global_description?.caption) || ""
  ).trim();
  const findings = currentEvidence && currentEvidence.final_findings || [];
  const imgMeta = currentEvidence && currentEvidence.image || {};
  currentRealBoxes = [];
  if (imgMeta.width && imgMeta.height) {
    for (const f of findings) {
      if (!f || !f.bbox) continue;
      const [x1, y1, x2, y2] = f.bbox;
      currentRealBoxes.push({
        l: x1 / imgMeta.width * 100,
        t: y1 / imgMeta.height * 100,
        w: (x2 - x1) / imgMeta.width * 100,
        h: (y2 - y1) / imgMeta.height * 100
      });
    }
  }
  const textCount = currentEvidence?.image_redaction?.textRegionsRedacted ?? findings.length;
  const faceCount = currentEvidence?.image_redaction?.faceRegionsRedacted ?? currentEvidence?.face_detection?.count ?? 0;
  const total = (Number(textCount) || 0) + (Number(faceCount) || 0);
  hideProcessing();
  reviewSection.classList.add("active");
  showRealImage(redactedImageUrl, `${sourceLabel} \u2014 ${total} region(s) redacted on-device`);
  buildContextBlock(currentEvidence, response.totalTimeMs);
  setBadges(groupFindings(findings, Number(faceCount) || 0));
  btnVisual.classList.add("active");
  btnContext.classList.remove("active");
  contextBlock.classList.remove("active");
  mockBrowser.style.display = "";
  contextViewed = false;
  applyState(total > 0 ? "protected" : "clean", {
    subtitle: total > 0 ? `${total} item${total === 1 ? "" : "s"} protected` : "No sensitive info detected"
  });
}
function groupFindings(findings, faceCount) {
  const counts = /* @__PURE__ */ new Map();
  for (const f of findings || []) {
    const key = String(f && f.entity || f && f.type || "PII").toUpperCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (faceCount > 0) counts.set("FACE", (counts.get("FACE") || 0) + faceCount);
  return [...counts.entries()];
}
var BADGE_EMOJI = {
  PERSON: "\u{1F464}",
  NAME: "\u{1F464}",
  EMAIL: "\u2709\uFE0F",
  PHONE: "\u{1F4DE}",
  ADDRESS: "\u{1F4CD}",
  FACE: "\u{1F642}",
  URL: "\u{1F517}",
  IP: "\u{1F517}",
  CARD: "\u{1F4B3}",
  SSN: "\u{1FAAA}"
};
function setBadges(entries) {
  badgeList.innerHTML = "";
  for (const [type, count] of entries) {
    const chip = document.createElement("span");
    chip.className = "finding-badge";
    chip.textContent = `${BADGE_EMOJI[type] || "\u{1F512}"} ${type} ${count}`;
    badgeList.appendChild(chip);
  }
  liveBadges = true;
}
function buildContextBlock(evidence, totalTimeMs) {
  contextBlock.innerHTML = "";
  const lines = [];
  lines.push(["{", null]);
  if (currentCaption) lines.push(['  "caption"', currentCaption, true]);
  const redactedText = String(evidence && evidence.redaction?.redacted_ocr_text || "").trim();
  if (redactedText) {
    lines.push(['  "redacted_text"', truncate(redactedText, 500), true]);
  }
  const findings = evidence && evidence.final_findings || [];
  lines.push([
    '  "findings"',
    findings.length ? groupFindings(findings, 0).map(([t, c]) => `${t} \xD7${c}`).join(", ") : "none",
    true
  ]);
  if (totalTimeMs !== void 0 && totalTimeMs !== null) {
    lines.push(['  "inference_ms"', String(totalTimeMs), false]);
  }
  lines.push(["}", null]);
  lines.forEach(([key, value, redact], idx) => {
    if (value === null || value === void 0) {
      contextBlock.appendChild(document.createTextNode((idx > 0 ? ",\n" : "") + key));
      return;
    }
    const prefix = idx > 0 ? ",\n" : "";
    contextBlock.appendChild(document.createTextNode(prefix));
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = key;
    contextBlock.appendChild(k);
    contextBlock.appendChild(document.createTextNode(": "));
    const v = document.createElement("span");
    if (redact) v.className = "v-redacted";
    v.textContent = `"${value}"`;
    contextBlock.appendChild(v);
  });
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}
function showRealImage(src, label) {
  usingRealImage = true;
  realImage.src = src;
  mockBody.style.display = "none";
  realImageWrap.style.display = "block";
  captureSourceNote.style.display = "block";
  captureSourceNote.textContent = label;
  refreshBboxOverlay();
}
function showMockImage() {
  usingRealImage = false;
  currentRealBoxes = [];
  mockBody.style.display = "";
  realImageWrap.style.display = "none";
  captureSourceNote.style.display = "none";
  refreshBboxOverlay();
}
function sanitizeText(text) {
  let count = 0;
  let out = text;
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => {
    count++;
    return "[REDACTED:EMAIL]";
  });
  out = out.replace(/\b(?:\+?\d[\d\-\s]{7,}\d)\b/g, () => {
    count++;
    return "[REDACTED:PHONE]";
  });
  out = out.replace(
    /\b\d{1,5}\s+\w+(?:\s\w+)?\s(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Blvd|Drive|Dr)\b/gi,
    () => {
      count++;
      return "[REDACTED:ADDRESS]";
    }
  );
  out = out.replace(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g, () => {
    count++;
    return "[PERSON]";
  });
  return { redacted: out, count };
}
function showSanitizedText(redacted, count) {
  sanitizedTextOutput.textContent = redacted;
  statTextFindings.textContent = count;
  statTextChars.textContent = redacted.length;
  textInputCard.style.display = "none";
  textOutputCard.style.display = "";
  textStatsGrid.style.display = "";
}
function runTextSanitize() {
  const raw = textCaptureInput.value;
  if (!raw.trim()) {
    alert("Paste or type some text first.");
    return;
  }
  const { redacted, count } = sanitizeText(raw);
  showSanitizedText(redacted, count);
}
document.getElementById("btnRunTextSanitize").addEventListener("click", runTextSanitize);
function setupTextBlock(prefill) {
  const pre = String(prefill || "").trim();
  textCaptureInput.value = pre;
  textInputCard.style.display = "";
  textOutputCard.style.display = "none";
  textStatsGrid.style.display = "none";
  if (pre) runTextSanitize();
}
async function runTextFlow() {
  showProcessing("Capturing page text\u2026");
  markStep(1);
  try {
    const res = await chrome.runtime.sendMessage({
      target: "background",
      action: "REQUEST_DOM_CAPTURE"
    });
    if (res && res.status === "SUCCESS" && res.capture) {
      onDomCaptureComplete(res.capture);
    } else {
      throw new Error(res && res.error || "DOM capture failed");
    }
  } catch (err) {
    alert("DOM capture failed: " + err.message);
    resetView();
  }
}
function onDomCaptureComplete(capture) {
  const findings = capture.findings || [];
  const redacted = String(capture.redactedDocument || "(no visible text captured)").trim();
  hideProcessing();
  reviewSection.classList.add("active");
  setupTextBlock("");
  showSanitizedText(redacted, findings.length);
  setBadges(groupFindings(findings.map((f) => ({ entity: f.type })), 0));
  contextViewed = false;
  applyState(findings.length > 0 ? "protected" : "clean", {
    subtitle: findings.length > 0 ? `${findings.length} item${findings.length === 1 ? "" : "s"} protected` : "No sensitive info detected"
  });
}
async function runCaptureWithMode(mode) {
  const wantsImage = mode === "image" || mode === "both";
  const wantsText = mode === "text" || mode === "both";
  imageResultBlock.style.display = wantsImage ? "" : "none";
  textResultBlock.style.display = wantsText ? "" : "none";
  copyImageRow.style.display = wantsImage ? "" : "none";
  if (wantsImage) {
    let blob = null;
    if (hasExtensionAPIs) {
      showProcessing();
      markStep(0);
      try {
        blob = await captureVisibleTabImage();
      } catch (err) {
        alert("Capture failed: " + err.message);
        resetView();
        return;
      }
    } else {
      blob = await acquirePreviewImageBlob();
      if (!blob) {
        imageResultBlock.style.display = "";
        textResultBlock.style.display = "none";
        copyImageRow.style.display = "";
        runSimulatedSteps(() => showMockImage());
        if (wantsText) setupTextBlock(capturedSelectionText);
        return;
      }
    }
    await runImagePipeline(blob, "Captured");
    if (wantsText) {
      if (hasExtensionAPIs) await runTextFlow();
      else setupTextBlock(capturedSelectionText);
    }
  } else {
    if (hasExtensionAPIs) {
      await runTextFlow();
    } else {
      runSimulatedSteps(() => setupTextBlock(capturedSelectionText));
    }
  }
}
document.getElementById("btnCapture").addEventListener("click", () => {
  try {
    capturedSelectionText = window.getSelection ? window.getSelection().toString() : "";
  } catch {
    capturedSelectionText = "";
  }
  captureModalBackdrop.classList.add("active");
});
document.querySelectorAll(".modal-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    captureModalBackdrop.classList.remove("active");
    void runCaptureWithMode(btn.dataset.mode);
  });
});
document.getElementById("btnCaptureModalCancel").addEventListener("click", () => captureModalBackdrop.classList.remove("active"));
captureModalBackdrop.addEventListener("click", (e) => {
  if (e.target === captureModalBackdrop) captureModalBackdrop.classList.remove("active");
});
function resetView() {
  hideProcessing();
  reviewSection.classList.remove("active");
  showMockImage();
  contextBlock.innerHTML = defaultContextHTML;
  badgeList.innerHTML = defaultBadgeHTML;
  statusTitle.textContent = defaultStatusTitle;
  statusSubtitle.textContent = defaultStatusSubtitle;
  helperNote.textContent = defaultHelperNote;
  textCaptureInput.value = "";
  textInputCard.style.display = "";
  textOutputCard.style.display = "none";
  textStatsGrid.style.display = "none";
  fileInput.value = "";
  contextViewed = false;
  currentEvidence = null;
  currentCaption = "";
  currentState = "protected";
  liveBadges = false;
  document.querySelectorAll("#demoStates button").forEach((b) => b.classList.toggle("active", b.dataset.state === "protected"));
}
document.getElementById("btnNewCapture").addEventListener("click", resetView);
document.getElementById("btnOpenDashboard").addEventListener("click", () => {
  if (hasExtensionAPIs) {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  } else {
    window.open(window.location.href, "_blank");
  }
});
btnVisual.addEventListener("click", () => {
  btnVisual.classList.add("active");
  btnContext.classList.remove("active");
  contextBlock.classList.remove("active");
  mockBrowser.style.display = "";
});
btnContext.addEventListener("click", () => {
  btnContext.classList.add("active");
  btnVisual.classList.remove("active");
  contextBlock.classList.add("active");
  mockBrowser.style.display = "none";
  contextViewed = true;
  applyState(currentState);
});
function refreshBboxOverlay() {
  mockBody.querySelectorAll(".bbox-ring").forEach((el) => el.remove());
  realImageWrap.querySelectorAll(".bbox-ring").forEach((el) => el.remove());
  if (!bboxToggle.checked) return;
  if (usingRealImage) {
    for (const { l, t, w, h } of currentRealBoxes) {
      const ring = document.createElement("div");
      ring.className = "bbox-ring";
      ring.style.left = l + "%";
      ring.style.top = t + "%";
      ring.style.width = w + "%";
      ring.style.height = h + "%";
      realImageWrap.appendChild(ring);
    }
  } else {
    mockBody.querySelectorAll(".mock-redacted").forEach((el) => {
      const r = el.getBoundingClientRect();
      const p = mockBody.getBoundingClientRect();
      const ring = document.createElement("div");
      ring.className = "bbox-ring";
      ring.style.left = r.left - p.left - 2 + "px";
      ring.style.top = r.top - p.top - 2 + "px";
      ring.style.width = r.width + "px";
      ring.style.height = r.height + "px";
      mockBody.appendChild(ring);
    });
  }
}
bboxToggle.addEventListener("change", refreshBboxOverlay);
var destURLs = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app"
};
function getSelectedDest() {
  const el = document.querySelector(".dest-option.selected");
  return el ? el.dataset.dest : "chatgpt";
}
document.getElementById("destGrid").addEventListener("click", (e) => {
  const opt = e.target.closest(".dest-option");
  if (!opt) return;
  document.querySelectorAll(".dest-option").forEach((o) => o.classList.remove("selected"));
  opt.classList.add("selected");
  void persistSettings();
});
function openUrl(url) {
  if (hasTabsAPI) chrome.tabs.create({ url });
  else window.open(url, "_blank");
}
function getSanitizedPayload() {
  const header = "[Sanitized capture from PerScope \u2014 placeholders like [PERSON] and [REDACTED:TYPE] stand in for removed personal data.]\n\n";
  const parts = [];
  if (imageResultBlock.style.display !== "none") {
    const ctx = contextBlock.innerText.trim();
    if (ctx) parts.push(ctx);
  }
  if (textResultBlock.style.display !== "none" && textOutputCard.style.display !== "none") {
    const txt = sanitizedTextOutput.textContent.trim();
    if (txt) parts.push(txt);
  }
  return header + (parts.length ? parts.join("\n\n---\n\n") : "(no content captured yet)");
}
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}
async function getResultImageBlob() {
  if (redactedImageBlob) return redactedImageBlob;
  if (usingRealImage && realImage.src) {
    const res = await fetch(realImage.src);
    return await res.blob();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#F4F2ED";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#DDD8C8";
  ctx.fillRect(24, 24, 592, 14);
  ctx.fillRect(24, 50, 400, 10);
  ctx.fillRect(24, 68, 300, 10);
  ctx.fillStyle = "#582F0E";
  ctx.fillRect(24, 96, 260, 18);
  ctx.fillRect(24, 124, 220, 18);
  ctx.fillRect(24, 152, 180, 18);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
function flashLabel(el, msg, delay) {
  const original = el.textContent;
  el.textContent = msg;
  setTimeout(() => el.textContent = original, delay || 1600);
}
document.getElementById("btnCopyImage").addEventListener("click", async () => {
  const label = document.getElementById("btnCopyImageLabel");
  try {
    const blob = await getResultImageBlob();
    if (!(navigator.clipboard && window.ClipboardItem)) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    flashLabel(label, "Copied \u2713");
  } catch {
    flashLabel(label, "Clipboard blocked \u2014 try again");
  }
});
btnSend.addEventListener("click", async () => {
  if (btnSend.disabled) return;
  const ok = await copyTextToClipboard(getSanitizedPayload());
  flashLabel(btnSendLabel, ok ? "Copied \u2014 opening\u2026" : "Copy blocked \u2014 opening\u2026");
  openUrl(destURLs[getSelectedDest()] || destURLs.chatgpt);
});
function applyState(state, overrides = {}) {
  currentState = state;
  document.querySelectorAll("#demoStates button").forEach((b) => b.classList.toggle("active", b.dataset.state === state));
  headerBadge.classList.remove("state-ambiguous", "state-blocked");
  statusIcon.classList.remove("warn", "danger");
  btnSend.disabled = false;
  helperNote.textContent = defaultHelperNote;
  if (state === "protected") {
    headerBadgeText.textContent = "Protected";
    statusTitle.textContent = "Ready to send";
    statusSubtitle.textContent = overrides.subtitle || (liveBadges ? statusSubtitle.textContent : "2 items protected");
    if (!overrides.keepBadges && !liveBadges) {
      badgeList.innerHTML = '<span class="finding-badge">\u{1F464} PERSON 1</span><span class="finding-badge">\u2709\uFE0F EMAIL 1</span>';
    }
  }
  if (state === "clean") {
    headerBadgeText.textContent = "Protected";
    statusTitle.textContent = "Ready to send";
    statusSubtitle.textContent = overrides.subtitle || (liveBadges ? statusSubtitle.textContent : "No sensitive info detected");
    if (!overrides.keepBadges && !liveBadges) badgeList.innerHTML = "";
  }
  if (state === "ambiguous") {
    liveBadges = false;
    headerBadge.classList.add("state-ambiguous");
    headerBadgeText.textContent = "Reviewing";
    statusIcon.classList.add("warn");
    statusTitle.textContent = "Low-confidence detection";
    statusSubtitle.textContent = "Review the Context tab before sending";
    badgeList.innerHTML = '<span class="finding-badge">\u26A0\uFE0F UNCERTAIN 1</span>';
    if (!contextViewed) {
      btnSend.disabled = true;
      helperNote.textContent = "Open the Context tab to review the uncertain item, then send.";
    }
  }
  if (state === "blocked") {
    liveBadges = false;
    headerBadge.classList.add("state-blocked");
    headerBadgeText.textContent = "Blocked";
    statusIcon.classList.add("danger");
    statusTitle.textContent = "Cannot sanitize this capture";
    statusSubtitle.textContent = "Sending is disabled until this is resolved";
    badgeList.innerHTML = '<span class="finding-badge">\u26D4 UNRESOLVED REGION 1</span>';
    btnSend.disabled = true;
    helperNote.textContent = "This capture could not be fully redacted. Try again or edit manually.";
  }
}
document.getElementById("demoStates").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  contextViewed = false;
  applyState(b.dataset.state);
});
(async function init() {
  const stored = await storeGet({
    "perscope-theme": null,
    "perscope-popup-settings": null
  });
  let theme = stored["perscope-theme"];
  if (!theme) {
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      theme = "light";
    }
  }
  applyTheme(theme === "dark" ? "dark" : "light", false);
  const s = stored["perscope-popup-settings"];
  if (s) {
    if (Number.isInteger(s.deviceTier) && selectDeviceTier.options[s.deviceTier]) {
      selectDeviceTier.selectedIndex = s.deviceTier;
    }
    if (Number.isInteger(s.redactionStyle) && selectRedactionStyle.options[s.redactionStyle]) {
      selectRedactionStyle.selectedIndex = s.redactionStyle;
    }
    checkFastVLM.checked = s.fastvlm !== false;
    checkFaceDetection.checked = s.face !== false;
    if (s.dest && destURLs[s.dest]) {
      document.querySelectorAll(".dest-option").forEach(
        (o) => o.classList.toggle("selected", o.dataset.dest === s.dest)
      );
    }
  }
  applyState("protected");
  await initDeviceStatus();
  await refreshBridgeStatus();
})();
;globalThis.__PERSCOPE_BUILD={"commit":"d8072c4","time":"2026-09-28T17:26:47.256Z"};
