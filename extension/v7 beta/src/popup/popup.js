/**
 * PerScope popup — UI behaviour + real on-device pipeline wiring.
 *
 * This module implements the behaviour for the popup shell in popup.html:
 * theme toggle, capture-mode modal, processing stepper, upload / paste /
 * tab-capture inputs, image + text review, bbox overlay, destination picker,
 * copy / send actions, advanced settings and the preview-state switcher.
 *
 * Where the extension backend is reachable (packaged MV3 extension:
 * `chrome.runtime.sendMessage` exists) every flow runs the REAL on-device
 * pipeline — tab capture via the background service worker, redaction via
 * the offscreen document (RUN_PIPELINE), page-text capture via the content
 * script (REQUEST_DOM_CAPTURE), device detection (GET_DEVICE_INFO) and
 * bridge status (BRIDGE_STATUS) — using the same message protocol as the
 * previous popup revision. Settings (device tier, redaction style,
 * FastVLM / face toggles, destination, theme) are persisted and fed into
 * each pipeline run.
 *
 * Where the backend is NOT reachable (e.g. the file is opened directly in a
 * browser for UI preview) the same controls fall back to fully local demo
 * behaviour: the synthetic mock capture, a real regex-based text sanitizer,
 * the Async Clipboard API and getDisplayMedia. Nothing is uploaded anywhere
 * in either path.
 */

// ---------------------------------------------------------------------------
// Environment + storage helpers
// ---------------------------------------------------------------------------

const hasExtensionAPIs =
  typeof chrome !== "undefined" && !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
const hasTabsAPI = hasExtensionAPIs && !!(chrome.tabs && chrome.tabs.create);
const hasStorageAPI = hasExtensionAPIs && !!(chrome.storage && chrome.storage.local);

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
    /* storage unavailable (private mode etc.) — non-fatal */
  }
}

async function storeGet(keys) {
  if (hasStorageAPI) {
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      /* fall through to localStorage */
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
      /* fall through to localStorage */
    }
  }
  for (const [k, v] of Object.entries(obj)) localSet(k, JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Element handles (every id below exists in popup.html)
// ---------------------------------------------------------------------------

const shell = document.getElementById("popupShell");
const themeIcon = document.getElementById("themeIcon");

const processingCard = document.getElementById("processingCard");
const processingLabel = document.getElementById("processingLabel");
const stepEls = [...document.querySelectorAll("#stepsProgress .step-item")];
const stageLabels = ["Capturing…", "Extracting…", "Detecting sensitive info…", "Sanitizing…"];

const reviewSection = document.getElementById("reviewSection");
const imageResultBlock = document.getElementById("imageResultBlock");
const textResultBlock = document.getElementById("textResultBlock");
const copyImageRow = document.getElementById("copyImageRow");

const mockBrowser = document.getElementById("mockBrowser");
const mockBody = document.getElementById("mockBody");
const realImageWrap = document.getElementById("realImageWrap");
const realImage = document.getElementById("realImage");
const captureSourceNote = document.getElementById("captureSourceNote");

const btnVisual = document.getElementById("btnViewVisual");
const btnContext = document.getElementById("btnViewContext");
const contextBlock = document.getElementById("contextBlock");
const defaultContextHTML = contextBlock.innerHTML;

const textInputCard = document.getElementById("textInputCard");
const textCaptureInput = document.getElementById("textCaptureInput");
const textOutputCard = document.getElementById("textOutputCard");
const sanitizedTextOutput = document.getElementById("sanitizedTextOutput");
const textStatsGrid = document.getElementById("textStatsGrid");
const statTextFindings = document.getElementById("statTextFindings");
const statTextChars = document.getElementById("statTextChars");

const headerBadge = document.getElementById("headerBadge");
const headerBadgeText = document.getElementById("headerBadgeText");
const statusIcon = document.getElementById("statusIcon");
const statusTitle = document.getElementById("statusTitle");
const statusSubtitle = document.getElementById("statusSubtitle");
const badgeList = document.getElementById("badgeList");
const defaultBadgeHTML = badgeList.innerHTML;
const defaultStatusTitle = statusTitle.textContent;
const defaultStatusSubtitle = statusSubtitle.textContent;

const btnSend = document.getElementById("btnSend");
const btnSendLabel = document.getElementById("btnSendLabel");
const helperNote = document.getElementById("helperNote");
const defaultHelperNote = helperNote.textContent;

const bboxToggle = document.getElementById("bboxToggle");
const fileInput = document.getElementById("fileInput");
const captureModalBackdrop = document.getElementById("captureModalBackdrop");

const selectDeviceTier = document.getElementById("selectDeviceTier");
const selectRedactionStyle = document.getElementById("selectRedactionStyle");
const checkFastVLM = document.getElementById("checkFastVLM");
const checkFaceDetection = document.getElementById("checkFaceDetection");

const deviceNote = document.getElementById("deviceNote");
const footerDeviceItem = document.getElementById("footerDeviceItem");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let originalImageBlob = null;
let originalImageUrl = null;
let redactedImageBlob = null;
let redactedImageUrl = null;
let currentEvidence = null;
let currentCaption = "";
let lastTotalTimeMs = null; // last completed job wall time (caption rebuild)
let currentDevice = null;
let currentBridge = null;
let activeJobId = null;
let usingRealImage = false;
let currentRealBoxes = []; // [{l,t,w,h}] in percent, from evidence.final_findings
let contextViewed = false;
let currentState = "protected";
let liveBadges = false; // true once a real pipeline run has populated badgeList
let capturedSelectionText = "";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const ICON_SUN =
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';

function applyTheme(t, persist = true) {
  shell.setAttribute("data-theme", t);
  themeIcon.innerHTML = t === "dark" ? ICON_MOON : ICON_SUN;
  if (persist) void storeSet({ "perscope-theme": t });
}

document.getElementById("btnTheme").addEventListener("click", () => {
  applyTheme(shell.getAttribute("data-theme") === "light" ? "dark" : "light");
});

// ---------------------------------------------------------------------------
// Advanced collapsible (also opened by the header gear)
// ---------------------------------------------------------------------------

const advToggle = document.getElementById("advancedToggle");
const advBody = document.getElementById("advancedBody");

function toggleAdvanced(force) {
  const open = force !== undefined ? force : !advBody.classList.contains("open");
  advBody.classList.toggle("open", open);
  advToggle.classList.toggle("open", open);
}

advToggle.addEventListener("click", () => toggleAdvanced());
document.getElementById("btnAdvancedFromGear").addEventListener("click", () => toggleAdvanced(true));

// ---------------------------------------------------------------------------
// Settings <-> pipeline options
// ---------------------------------------------------------------------------

function getForceTier() {
  const v = selectDeviceTier.value || "";
  if (v.startsWith("Integrated")) return "integrated";
  if (v.startsWith("CPU")) return "cpu";
  return null; // Auto (dedicated GPU priority)
}

function getRedactionStyle() {
  return (selectRedactionStyle.value || "").startsWith("Black") ? "black" : "blur";
}

function currentPipelineOptions() {
  return {
    forceDeviceTier: getForceTier(),
    redactionStyle: getRedactionStyle(),
    fastvlmEnabled: checkFastVLM.checked,
    faceEnabled: checkFaceDetection.checked,
  };
}

function persistSettings() {
  return storeSet({
    "perscope-popup-settings": {
      deviceTier: selectDeviceTier.selectedIndex,
      redactionStyle: selectRedactionStyle.selectedIndex,
      fastvlm: checkFastVLM.checked,
      face: checkFaceDetection.checked,
      dest: getSelectedDest(),
    },
  });
}

selectDeviceTier.addEventListener("change", () => {
  void persistSettings();
  void initDeviceStatus();
});
selectRedactionStyle.addEventListener("change", () => void persistSettings());
checkFastVLM.addEventListener("change", () => void persistSettings());
checkFaceDetection.addEventListener("change", () => void persistSettings());

// ---------------------------------------------------------------------------
// Device + bridge status (surfaced as hover tooltips so the visible UI stays
// exactly as designed; the values still drive GET_DEVICE_INFO + RUN_PIPELINE)
// ---------------------------------------------------------------------------

function refreshStatusTooltips() {
  const deviceBits = currentDevice
    ? `On-device inference: ${currentDevice.label || currentDevice.description || currentDevice.tier} (${String(currentDevice.tier || "cpu").toUpperCase()})`
    : "On-device inference: detecting hardware…";
  const bridgeBits = currentBridge
    ? `Bridge: ${currentBridge.paired ? "connected + paired" : currentBridge.connected ? "reachable, not paired" : "not running"}`
    : "Bridge: checking…";
  const tip = `${deviceBits}. ${bridgeBits}. Everything stays on this device.`;
  deviceNote.title = tip;
  footerDeviceItem.title = tip;
}

async function initDeviceStatus() {
  refreshStatusTooltips();
  if (!hasExtensionAPIs) {
    deviceNote.title = "Preview mode — the packaged extension runs this pipeline fully on-device.";
    return;
  }
  try {
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "GET_DEVICE_INFO",
      forceTier: getForceTier(),
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

// ---------------------------------------------------------------------------
// Processing stepper
// ---------------------------------------------------------------------------

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

// Simulated walk used only when the extension backend is unreachable
// (UI preview) or for the local regex text path.
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

// Real pipeline progress from the offscreen document.
if (hasExtensionAPIs && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== "ui") return;
    // Async VLM caption (post-delivery upgrade of the template caption):
    // only applies to the currently displayed job; template stands otherwise.
    if (message.action === "CAPTION_RESULT") {
      if (message.jobId !== activeJobId || !message.caption) return;
      currentCaption = String(message.caption);
      if (currentEvidence && currentEvidence.global_description) {
        currentEvidence.global_description.caption = currentCaption;
        currentEvidence.global_description.source = "fastvlm-caption";
      }
      buildContextBlock(currentEvidence, lastTotalTimeMs);
      return;
    }
    if (message.action !== "PIPELINE_PROGRESS") return;
    if (message.jobId !== activeJobId) return;
    const stage = message.progress && message.progress.stage;
    const map = { OCR: 0, NER: 1, FACE: 2, FASTVLM: 2, REDACT: 3 };
    if (stage && map[stage] !== undefined) markStep(map[stage]);
  });
}

// ---------------------------------------------------------------------------
// Image intake: upload / paste
// ---------------------------------------------------------------------------

function isImageFile(file) {
  return !!file && !!file.type && file.type.startsWith("image/");
}

function loadImageFile(file, sourceLabel) {
  if (!isImageFile(file)) {
    alert("That file isn’t an image — pick a PNG, JPG or WebP.");
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
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) loadImageFile(file, "Pasted");
      e.preventDefault();
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Tab capture
// ---------------------------------------------------------------------------

// Packaged extension path: the real visible-tab screenshot.
async function captureVisibleTabImage() {
  const res = await chrome.runtime.sendMessage({ target: "background", action: "CAPTURE_VISIBLE_TAB" });
  if (res && res.dataUrl) {
    const blobRes = await fetch(res.dataUrl);
    return await blobRes.blob();
  }
  throw new Error((res && res.error) || "Tab capture failed");
}

// Preview fallback: screen/tab share via getDisplayMedia (the demo page cannot
// call chrome.tabs.captureVisibleTab — that only exists in the packaged
// extension). Returns a Blob or null when cancelled / unavailable.
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
      return null; // picker cancelled or blocked
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Real image pipeline (offscreen RUN_PIPELINE)
// ---------------------------------------------------------------------------

async function runImagePipeline(blob, sourceLabel) {
  originalImageBlob = blob;
  if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
  originalImageUrl = URL.createObjectURL(blob);

  if (!hasExtensionAPIs) {
    // Preview path: animate the steps, then show the synthetic mock capture.
    runSimulatedSteps(() => showMockImage());
    return;
  }

  showProcessing("Capturing page…");
  markStep(0);
  activeJobId = `job_${Date.now()}`;
  const options = currentPipelineOptions();

  try {
    const buffer = await blob.arrayBuffer();
    // Plain Array<number>: structured clone handles this without the GC
    // pressure of a JSON-serialised number array.
    const imageBytes = Array.from(new Uint8Array(buffer));
    await chrome.runtime.sendMessage({ target: "background", action: "ENSURE_OFFSCREEN" });
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "RUN_PIPELINE",
      jobId: activeJobId,
      imageBytes,
      options,
    });
    if (response && response.status === "SUCCESS") {
      onPipelineComplete(response, sourceLabel);
    } else {
      throw new Error((response && response.error) || "Pipeline failed");
    }
  } catch (err) {
    alert("Pipeline Error: " + err.message);
    resetView();
  }
}

function onPipelineComplete(response, sourceLabel) {
  // Reconstruct the redacted PNG (base64 avoids the huge number-array trip).
  const outputBase64 = response.outputBase64;
  if (!outputBase64) throw new Error("No output image from pipeline");
  const binaryStr = atob(outputBase64);
  const byteArray = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) byteArray[i] = binaryStr.charCodeAt(i);
  redactedImageBlob = new Blob([byteArray], { type: "image/png" });
  if (redactedImageUrl) URL.revokeObjectURL(redactedImageUrl);
  redactedImageUrl = URL.createObjectURL(redactedImageBlob);

  currentEvidence = response.evidence || null;
  lastTotalTimeMs = response.totalTimeMs ?? null;
  currentCaption = String(
    (currentEvidence && (currentEvidence.fastvlm_adjudication?.caption ||
      currentEvidence.global_description?.caption)) ||
      ""
  ).trim();

  const findings = (currentEvidence && currentEvidence.final_findings) || [];
  const imgMeta = (currentEvidence && currentEvidence.image) || {};
  currentRealBoxes = [];
  if (imgMeta.width && imgMeta.height) {
    for (const f of findings) {
      if (!f || !f.bbox) continue;
      const [x1, y1, x2, y2] = f.bbox;
      currentRealBoxes.push({
        l: (x1 / imgMeta.width) * 100,
        t: (y1 / imgMeta.height) * 100,
        w: ((x2 - x1) / imgMeta.width) * 100,
        h: ((y2 - y1) / imgMeta.height) * 100,
      });
    }
  }

  const textCount =
    currentEvidence?.image_redaction?.textRegionsRedacted ?? findings.length;
  const faceCount =
    currentEvidence?.image_redaction?.faceRegionsRedacted ??
    currentEvidence?.face_detection?.count ??
    0;
  const total = (Number(textCount) || 0) + (Number(faceCount) || 0);

  hideProcessing();
  reviewSection.classList.add("active");
  showRealImage(redactedImageUrl, `${sourceLabel} — ${total} region(s) redacted on-device`);
  buildContextBlock(currentEvidence, response.totalTimeMs);
  setBadges(groupFindings(findings, Number(faceCount) || 0));

  // Back to the Visual tab; the ambiguous gate re-arms on new evidence.
  btnVisual.classList.add("active");
  btnContext.classList.remove("active");
  contextBlock.classList.remove("active");
  mockBrowser.style.display = "";
  contextViewed = false;
  applyState(total > 0 ? "protected" : "clean", {
    subtitle:
      total > 0
        ? `${total} item${total === 1 ? "" : "s"} protected`
        : "No sensitive info detected",
  });
}

function groupFindings(findings, faceCount) {
  const counts = new Map();
  for (const f of findings || []) {
    const key = String((f && f.entity) || (f && f.type) || "PII").toUpperCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (faceCount > 0) counts.set("FACE", (counts.get("FACE") || 0) + faceCount);
  return [...counts.entries()];
}

const BADGE_EMOJI = {
  PERSON: "👤",
  NAME: "👤",
  EMAIL: "✉️",
  PHONE: "📞",
  ADDRESS: "📍",
  FACE: "🙂",
  URL: "🔗",
  IP: "🔗",
  CARD: "💳",
  SSN: "🪪",
};

function setBadges(entries) {
  badgeList.innerHTML = "";
  for (const [type, count] of entries) {
    const chip = document.createElement("span");
    chip.className = "finding-badge";
    chip.textContent = `${BADGE_EMOJI[type] || "🔒"} ${type} ${count}`;
    badgeList.appendChild(chip);
  }
  // Live pipeline badges must survive later applyState() refreshes (e.g. the
  // Context-tab gate re-evaluation); only explicit resets clear them.
  liveBadges = true;
}

// Context tab content from real evidence. Only redacted strings and finding
// metadata are rendered — raw values never reach the DOM.
function buildContextBlock(evidence, totalTimeMs) {
  contextBlock.innerHTML = "";
  const lines = [];
  lines.push(["{", null]);
  if (currentCaption) lines.push(['  "caption"', currentCaption, true]);
  const redactedText = String((evidence && evidence.redaction?.redacted_ocr_text) || "").trim();
  if (redactedText) {
    lines.push(['  "redacted_text"', truncate(redactedText, 500), true]);
  }
  const findings = (evidence && evidence.final_findings) || [];
  lines.push([
    "  \"findings\"",
    findings.length
      ? groupFindings(findings, 0)
          .map(([t, c]) => `${t} ×${c}`)
          .join(", ")
      : "none",
    true,
  ]);
  if (totalTimeMs !== undefined && totalTimeMs !== null) {
    lines.push(['  "inference_ms"', String(totalTimeMs), false]);
  }
  lines.push(["}", null]);

  lines.forEach(([key, value, redact], idx) => {
    if (value === null || value === undefined) {
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
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------------------------------------------------------------------------
// Mock vs real image display
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Text sanitizer (local regex fallback — genuinely redacts, not simulated)
// ---------------------------------------------------------------------------

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
  if (pre) runTextSanitize(); // real selected text on hand — sanitize immediately
}

// Real page-text flow: content-script DOM snapshot (redact-before-render;
// raw values never reach this panel).
async function runTextFlow() {
  showProcessing("Capturing page text…");
  markStep(1);
  try {
    const res = await chrome.runtime.sendMessage({
      target: "background",
      action: "REQUEST_DOM_CAPTURE",
    });
    if (res && res.status === "SUCCESS" && res.capture) {
      onDomCaptureComplete(res.capture);
    } else {
      throw new Error((res && res.error) || "DOM capture failed");
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
    subtitle:
      findings.length > 0
        ? `${findings.length} item${findings.length === 1 ? "" : "s"} protected`
        : "No sensitive info detected",
  });
}

// ---------------------------------------------------------------------------
// Capture modal -> image / text / both
// ---------------------------------------------------------------------------

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
        // Picker cancelled and no backend: fall back to the sample capture.
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

// Grab any on-page text selection first (before the modal steals focus).
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

document
  .getElementById("btnCaptureModalCancel")
  .addEventListener("click", () => captureModalBackdrop.classList.remove("active"));
captureModalBackdrop.addEventListener("click", (e) => {
  if (e.target === captureModalBackdrop) captureModalBackdrop.classList.remove("active");
});

// ---------------------------------------------------------------------------
// Reset / dashboard
// ---------------------------------------------------------------------------

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
  document
    .querySelectorAll("#demoStates button")
    .forEach((b) => b.classList.toggle("active", b.dataset.state === "protected"));
}

document.getElementById("btnNewCapture").addEventListener("click", resetView);

document.getElementById("btnOpenDashboard").addEventListener("click", () => {
  if (hasExtensionAPIs) {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  } else {
    window.open(window.location.href, "_blank");
  }
});

// ---------------------------------------------------------------------------
// Visual / Context tabs
// ---------------------------------------------------------------------------

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
  applyState(currentState); // re-evaluate the ambiguous gate
});

// ---------------------------------------------------------------------------
// BBox overlay toggle (synthetic mock + real captured image)
// ---------------------------------------------------------------------------

function refreshBboxOverlay() {
  mockBody.querySelectorAll(".bbox-ring").forEach((el) => el.remove());
  realImageWrap.querySelectorAll(".bbox-ring").forEach((el) => el.remove());
  if (!bboxToggle.checked) return;
  if (usingRealImage) {
    // Real per-finding regions from evidence.final_findings. If the pipeline
    // reported no boxes, leave the image clean instead of inventing regions.
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

// ---------------------------------------------------------------------------
// Destination picker
// ---------------------------------------------------------------------------

const destURLs = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
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

// ---------------------------------------------------------------------------
// Clipboard helpers
// ---------------------------------------------------------------------------

function getSanitizedPayload() {
  const header =
    "[Sanitized capture from PerScope — placeholders like [PERSON] and [REDACTED:TYPE] stand in for removed personal data.]\n\n";
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
  // Synthetic fallback: draw a stand-in for the mock so there is always a
  // real PNG to copy.
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
  setTimeout(() => (el.textContent = original), delay || 1600);
}

// Copy the final result image.
document.getElementById("btnCopyImage").addEventListener("click", async () => {
  const label = document.getElementById("btnCopyImageLabel");
  try {
    const blob = await getResultImageBlob();
    if (!(navigator.clipboard && window.ClipboardItem)) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    flashLabel(label, "Copied ✓");
  } catch {
    flashLabel(label, "Clipboard blocked — try again");
  }
});

// Download the final result image as a PNG file (same blob as copy).
document.getElementById("btnDownloadImage").addEventListener("click", async () => {
  const label = document.getElementById("btnDownloadImageLabel");
  let url = null;
  try {
    const blob = await getResultImageBlob();
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `perscope-redacted-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flashLabel(label, "Downloaded ✓");
  } catch {
    flashLabel(label, "Download failed — try again");
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});

// Send: copy the sanitized result, then open the selected destination.
btnSend.addEventListener("click", async () => {
  if (btnSend.disabled) return;
  const ok = await copyTextToClipboard(getSanitizedPayload());
  flashLabel(btnSendLabel, ok ? "Copied — opening…" : "Copy blocked — opening…");
  openUrl(destURLs[getSelectedDest()] || destURLs.chatgpt);
});

// ---------------------------------------------------------------------------
// States: protected / clean / ambiguous / blocked
// ---------------------------------------------------------------------------

function applyState(state, overrides = {}) {
  currentState = state;
  document
    .querySelectorAll("#demoStates button")
    .forEach((b) => b.classList.toggle("active", b.dataset.state === state));
  headerBadge.classList.remove("state-ambiguous", "state-blocked");
  statusIcon.classList.remove("warn", "danger");
  btnSend.disabled = false;
  helperNote.textContent = defaultHelperNote;

  if (state === "protected") {
    headerBadgeText.textContent = "Protected";
    statusTitle.textContent = "Ready to send";
    statusSubtitle.textContent =
      overrides.subtitle || (liveBadges ? statusSubtitle.textContent : "2 items protected");
    if (!overrides.keepBadges && !liveBadges) {
      badgeList.innerHTML =
        '<span class="finding-badge">👤 PERSON 1</span><span class="finding-badge">✉️ EMAIL 1</span>';
    }
  }
  if (state === "clean") {
    headerBadgeText.textContent = "Protected";
    statusTitle.textContent = "Ready to send";
    statusSubtitle.textContent =
      overrides.subtitle || (liveBadges ? statusSubtitle.textContent : "No sensitive info detected");
    if (!overrides.keepBadges && !liveBadges) badgeList.innerHTML = "";
  }
  if (state === "ambiguous") {
    liveBadges = false;
    headerBadge.classList.add("state-ambiguous");
    headerBadgeText.textContent = "Reviewing";
    statusIcon.classList.add("warn");
    statusTitle.textContent = "Low-confidence detection";
    statusSubtitle.textContent = "Review the Context tab before sending";
    badgeList.innerHTML = '<span class="finding-badge">⚠️ UNCERTAIN 1</span>';
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
    badgeList.innerHTML = '<span class="finding-badge">⛔ UNRESOLVED REGION 1</span>';
    btnSend.disabled = true;
    helperNote.textContent = "This capture could not be fully redacted. Try again or edit manually.";
  }
}

document.getElementById("demoStates").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  contextViewed = false;
  // Manual preview override for testing this popup; real results re-apply
  // their own state (protected/clean) with live badges on the next run.
  applyState(b.dataset.state);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async function init() {
  const stored = await storeGet({
    "perscope-theme": null,
    "perscope-popup-settings": null,
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
      document.querySelectorAll(".dest-option").forEach((o) =>
        o.classList.toggle("selected", o.dataset.dest === s.dest)
      );
    }
  }

  applyState("protected");
  await initDeviceStatus();
  await refreshBridgeStatus();
})();
