var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../piidetector.js
var require_piidetector = __commonJS({
  "../../piidetector.js"(exports, module) {
    "use strict";
    var PATTERNS = {
      // ------------------------------------------------------------------------
      // BASIC PERSONAL INFORMATION
      // ------------------------------------------------------------------------
      EMAIL_ID: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
      PHONE_NUMBER: /(?<!\d)(?:\+91[\s.-]?)?[6-9]\d{9}(?!\d)/g,
      DATE_OF_BIRTH: /\b(?:DOB|D\.O\.B|Date of Birth|Birth Date)\s*[:\-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
      AGE: /\b(?:age)\s*[:\-]?\s*\d{1,3}\s*(?:years?|yrs?)?\b/gi,
      // ------------------------------------------------------------------------
      // GOVERNMENT / FINANCIAL IDENTIFIERS
      // ------------------------------------------------------------------------
      AADHAAR: /(?<!\d)(?:\d{4}[\s-]?){2}\d{4}(?!\d)/g,
      PAN_NUMBER: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,
      PASSPORT_NUMBER: /\b[A-Z][0-9]{7}\b/gi,
      VOTER_ID: /\b[A-Z]{3}[0-9]{7}\b/gi,
      DRIVING_LICENSE: /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b/gi,
      CARD_NUMBER: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
      BANK_ACCOUNT: /\b(?:account|a\/c|acct)\s*(?:number|no\.?)?\s*[:\-]?\s*\d{9,18}\b/gi,
      IBAN: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,
      IFSC_CODE: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
      SWIFT_BIC: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi,
      GSTIN: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Zz][A-Z0-9]\b/gi,
      TAX_ID: /\b(?:tax\s*(?:id|number)|TIN)\s*[:\-]?\s*[A-Z0-9-]{6,20}\b/gi,
      // ------------------------------------------------------------------------
      // DEVICE / NETWORK IDENTIFIERS
      // ------------------------------------------------------------------------
      IP_ADDRESS: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      MAC_ADDRESS: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
      DEVICE_ID: /\b(?:device\s*id|device\s*identifier)\s*[:\-]?\s*[A-Za-z0-9._:-]{6,50}\b/gi,
      // ------------------------------------------------------------------------
      // AUTHENTICATION / SECRETS
      // ------------------------------------------------------------------------
      USERNAME: /\b(?:username|user\s*name|login\s*id)\s*[:\-]?\s*[A-Za-z0-9._-]{3,40}\b/gi,
      PASSWORD: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
      PIN: /\b(?:PIN|pin\s*number)\s*[:\-]?\s*\d{4,6}\b/g,
      OTP: /\b(?:OTP|one[-\s]?time\s+password)\s*[:\-]?\s*\d{4,8}\b/gi,
      API_KEY: /\b(?:api[_\s-]?key|apikey)\s*[:=]\s*[A-Za-z0-9_-]{12,}\b/gi,
      // ------------------------------------------------------------------------
      // ORGANIZATION-SPECIFIC IDENTIFIERS
      // ------------------------------------------------------------------------
      EMPLOYEE_ID: /\b(?:employee\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      CUSTOMER_ID: /\b(?:customer\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      STUDENT_ID: /\b(?:student\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      PATIENT_ID: /\b(?:patient\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      POLICY_NUMBER: /\b(?:policy\s*(?:number|no\.?|id))\s*[:\-]?\s*[A-Za-z0-9-]{5,30}\b/gi
    };
    var REPLACEMENTS = {};
    for (const type of Object.keys(PATTERNS)) {
      REPLACEMENTS[type] = `<${type}>`;
    }
    function luhn(number) {
      const digits = String(number).replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) {
        return false;
      }
      let total = 0;
      for (let i = 0; i < digits.length; i++) {
        let n = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
          n *= 2;
          if (n > 9) {
            n -= 9;
          }
        }
        total += n;
      }
      return total % 10 === 0;
    }
    function ibanValid(iban) {
      const normalized = String(iban).replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) {
        return false;
      }
      const rearranged = normalized.slice(4) + normalized.slice(0, 4);
      let remainder = 0;
      for (const char of rearranged) {
        if (/[A-Z]/.test(char)) {
          const value = char.charCodeAt(0) - 55;
          const digits = String(value);
          for (const digit of digits) {
            remainder = (remainder * 10 + Number(digit)) % 97;
          }
        } else {
          remainder = (remainder * 10 + Number(char)) % 97;
        }
      }
      return remainder === 1;
    }
    function isValidIPv4(value) {
      const parts = String(value).split(".");
      if (parts.length !== 4) {
        return false;
      }
      return parts.every((part) => {
        if (!/^\d+$/.test(part)) {
          return false;
        }
        if (part.length > 1 && part.startsWith("0")) {
          return false;
        }
        const number = Number(part);
        return number >= 0 && number <= 255;
      });
    }
    function getContext(text, start, end, radius = 80) {
      return {
        before: text.slice(
          Math.max(0, start - radius),
          start
        ),
        after: text.slice(
          end,
          Math.min(text.length, end + radius)
        )
      };
    }
    function calculateConfidence(type, value, context) {
      let score = 0.5;
      const highConfidenceTypes = /* @__PURE__ */ new Set([
        "EMAIL_ID",
        "PAN_NUMBER",
        "AADHAAR",
        "IFSC_CODE",
        "GSTIN",
        "MAC_ADDRESS",
        "API_KEY",
        "PASSWORD",
        "OTP"
      ]);
      if (highConfidenceTypes.has(type)) {
        score += 0.25;
      }
      const combined = `${context.before} ${context.after}`.toLowerCase();
      const contextWords = [
        "email",
        "phone",
        "mobile",
        "address",
        "account",
        "password",
        "otp",
        "pin",
        "passport",
        "pan",
        "aadhaar",
        "bank",
        "card",
        "username",
        "login",
        "student",
        "employee",
        "patient"
      ];
      if (contextWords.some((word) => combined.includes(word))) {
        score += 0.2;
      }
      return Math.min(1, score);
    }
    function validateMatch(type, value) {
      switch (type) {
        case "CARD_NUMBER":
          return luhn(value);
        case "IBAN":
          return ibanValid(value);
        case "IP_ADDRESS":
          return isValidIPv4(value);
        default:
          return true;
      }
    }
    function detectPII2(text) {
      text = String(text ?? "");
      const detections = [];
      for (const [piiType, regex] of Object.entries(PATTERNS)) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const value = match[0];
          const start = match.index;
          const end = start + value.length;
          if (!validateMatch(piiType, value)) {
            continue;
          }
          const context = getContext(text, start, end);
          const confidence = calculateConfidence(
            piiType,
            value,
            context
          );
          detections.push({
            type: piiType,
            value,
            start,
            end,
            confidence
          });
        }
      }
      detections.sort((a, b) => {
        if (a.start !== b.start) {
          return a.start - b.start;
        }
        return b.end - b.start - (a.end - a.start);
      });
      const selected = [];
      for (const detection of detections) {
        const overlaps = selected.some(
          (existing) => detection.start < existing.end && detection.end > existing.start
        );
        if (!overlaps) {
          selected.push(detection);
        }
      }
      selected.sort(
        (a, b) => a.start - b.start
      );
      return {
        text,
        detections: selected
      };
    }
    function redactPII2(text, detections) {
      let result = String(text ?? "");
      const sorted = [...detections].sort((a, b) => b.start - a.start);
      for (const detection of sorted) {
        const replacement = REPLACEMENTS[detection.type] ?? "<PII>";
        result = result.slice(0, detection.start) + replacement + result.slice(detection.end);
      }
      return result;
    }
    function processPII(text) {
      const detectionResult = detectPII2(text);
      const redactedText = redactPII2(
        detectionResult.text,
        detectionResult.detections
      );
      return {
        // Safe output.
        text: redactedText,
        // Metadata.
        detections: detectionResult.detections.map((detection) => ({
          type: detection.type,
          start: detection.start,
          end: detection.end,
          confidence: detection.confidence
        }))
      };
    }
    function shouldIgnoreElement(element) {
      if (!element) {
        return true;
      }
      const tag = element.tagName?.toLowerCase();
      const ignoredTags = /* @__PURE__ */ new Set([
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "canvas"
      ]);
      if (ignoredTags.has(tag)) {
        return true;
      }
      if (element.hidden || element.getAttribute?.("aria-hidden") === "true") {
        return true;
      }
      return false;
    }
    function extractDOMText(root = document.body) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );
      const pieces = [];
      let node;
      while (node = walker.nextNode()) {
        const parent = node.parentElement;
        if (shouldIgnoreElement(parent)) {
          continue;
        }
        const value = node.nodeValue ?? "";
        if (!value.trim()) {
          continue;
        }
        pieces.push(value);
      }
      return pieces.join("\n");
    }
    function extractFormValues(root = document) {
      const fields = [];
      const elements = root.querySelectorAll?.(
        "input, textarea, select"
      ) ?? [];
      for (const element of elements) {
        if (shouldIgnoreElement(element)) {
          continue;
        }
        const value = element.value ?? "";
        if (!value) {
          continue;
        }
        fields.push({
          element,
          value
        });
      }
      return fields;
    }
    module.exports = {
      PATTERNS,
      REPLACEMENTS,
      luhn,
      ibanValid,
      isValidIPv4,
      detectPII: detectPII2,
      redactPII: redactPII2,
      processPII,
      extractDOMText,
      extractFormValues
    };
    if (__require.main === module) {
      const readline = __require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question(
        "\nPaste text to scan:\n",
        (input) => {
          const result = processPII(input);
          console.log(
            "\nREDACTED:\n"
          );
          console.log(result.text);
          console.log(
            "\nDETECTIONS:\n"
          );
          console.log(
            JSON.stringify(
              result.detections,
              null,
              2
            )
          );
          rl.close();
        }
      );
    }
  }
});

// src/pipeline/dom-heuristics.js
var FORCE_REDACT_AUTOCOMPLETE = /* @__PURE__ */ new Set([
  "current-password",
  "new-password",
  "cc-csc",
  "cc-number"
]);
function classifySensitiveField(element) {
  if (!element || typeof element.tagName !== "string") {
    return { forceRedact: false, reason: "not-an-element" };
  }
  const tag = element.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return { forceRedact: false, reason: "not-a-form-control" };
  }
  const type = String(element.getAttribute ? element.getAttribute("type") : element.type || "").trim().toLowerCase();
  if (type === "password") {
    return { forceRedact: true, reason: "input-type-password" };
  }
  if (type === "hidden") {
    return { forceRedact: true, reason: "input-type-hidden" };
  }
  const autocomplete = element.getAttribute ? element.getAttribute("autocomplete") : null;
  if (autocomplete) {
    const first = String(autocomplete).trim().toLowerCase().split(/\s+/).pop();
    if (FORCE_REDACT_AUTOCOMPLETE.has(first)) {
      return { forceRedact: true, reason: `autocomplete-${first}` };
    }
  }
  return { forceRedact: false, reason: "no-force-rule" };
}
function placeholderForForceRedact(element, reason) {
  const r = String(reason || "");
  if (r.includes("password") || r.includes("hidden")) return "<PASSWORD>";
  if (r.includes("cc-csc")) return "<PASSWORD>";
  if (r.includes("cc-number")) return "<CARD_NUMBER>";
  void element;
  return "<FORM_SECRET>";
}
function textOf(node) {
  if (!node) return "";
  if (typeof node.textContent === "string") return node.textContent;
  if (typeof node.innerText === "string") return node.innerText;
  if (typeof node.value === "string") return node.value;
  return "";
}
function collapseWhitespace(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function resolveStructuralHint(element) {
  if (!element) return void 0;
  const hint = {};
  const doc = element.ownerDocument || (typeof document !== "undefined" ? document : null);
  try {
    const id = element.getAttribute ? element.getAttribute("id") : element.id;
    if (id && doc && typeof doc.querySelector === "function") {
      const label = doc.querySelector(`label[for="${String(id).replace(/"/g, "")}"]`);
      const labelText = collapseWhitespace(textOf(label));
      if (labelText) hint.labelText = labelText;
    }
    if (!hint.labelText && typeof element.closest === "function") {
      const wrapped = element.closest("label");
      const wrappedText = collapseWhitespace(textOf(wrapped));
      if (wrappedText) hint.labelText = wrappedText;
    }
  } catch {
  }
  try {
    const labelledBy = element.getAttribute ? element.getAttribute("aria-labelledby") : null;
    if (labelledBy && doc && typeof doc.getElementById === "function") {
      const parts = [];
      for (const refId of String(labelledBy).split(/\s+/)) {
        if (!refId) continue;
        const ref = doc.getElementById(refId);
        const t = collapseWhitespace(textOf(ref));
        if (t) parts.push(t);
      }
      if (parts.length && !hint.labelText) hint.labelText = parts.join(" ");
    }
  } catch {
  }
  try {
    const autocomplete = element.getAttribute ? element.getAttribute("autocomplete") : null;
    if (autocomplete && String(autocomplete).trim()) {
      hint.autocompleteType = String(autocomplete).trim().toLowerCase();
    }
    const name = element.getAttribute ? element.getAttribute("name") : element.name;
    const idAttr = element.getAttribute ? element.getAttribute("id") : element.id;
    const fieldName = collapseWhitespace(name || idAttr || "");
    if (fieldName) hint.fieldName = fieldName;
  } catch {
  }
  try {
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "td" && typeof element.closest === "function") {
      const table = element.closest("table");
      if (table) {
        const cellIndex = Array.prototype.indexOf.call(
          element.parentNode ? element.parentNode.children : [],
          element
        );
        let headerText = "";
        if (typeof table.querySelectorAll === "function") {
          const headers = table.querySelectorAll("thead th, tr:first-child th");
          const header = headers && headers[cellIndex];
          headerText = collapseWhitespace(textOf(header));
        }
        if (headerText) hint.tableHeader = headerText;
      }
    }
    if (!hint.tableHeader && typeof element.closest === "function") {
      const cell = element.closest("td");
      if (cell && cell !== element) {
        const cellHint = resolveStructuralHint(cell);
        if (cellHint && cellHint.tableHeader) hint.tableHeader = cellHint.tableHeader;
      }
    }
  } catch {
  }
  return Object.keys(hint).length ? hint : void 0;
}
var HEADING_TAGS = /* @__PURE__ */ new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
var PARAGRAPH_TAGS = /* @__PURE__ */ new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre",
  "figcaption",
  "address"
]);
function getBlockRole(element) {
  if (!element || typeof element.tagName !== "string") return "inline";
  const tag = element.tagName.toLowerCase();
  if (HEADING_TAGS.has(tag)) return "heading";
  if (tag === "li") return "list_item";
  if (tag === "td" || tag === "th") return "table_cell";
  if (tag === "tr") return "table_cell";
  if (PARAGRAPH_TAGS.has(tag)) return "paragraph";
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") {
    return "inline";
  }
  return "inline";
}
function reconstructDocument(segments) {
  const lines = [];
  let pendingBlank = false;
  for (const seg of segments || []) {
    const text = collapseWhitespace(seg ? seg.redactedText : "");
    if (!text) continue;
    const role = seg.blockRole || "inline";
    if (role === "paragraph" || role === "heading") {
      if (lines.length) pendingBlank = true;
      if (pendingBlank) {
        lines.push("");
        pendingBlank = false;
      }
      lines.push(text);
      pendingBlank = true;
    } else if (role === "list_item" || role === "table_cell") {
      if (pendingBlank) {
        lines.push("");
        pendingBlank = false;
      }
      lines.push(text);
    } else {
      if (pendingBlank) {
        lines.push("");
        pendingBlank = false;
      }
      if (!lines.length) {
        lines.push(text);
      } else {
        lines[lines.length - 1] = `${lines[lines.length - 1]} ${text}`;
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

// src/pipeline/dom-capture.js
var IGNORED_TAGS = /* @__PURE__ */ new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas"
]);
var ATTRIBUTE_SEGMENT_NAMES = ["aria-label", "alt", "title", "placeholder"];
var FORM_VALUE_TAGS = /* @__PURE__ */ new Set(["input", "textarea", "select"]);
var FALLBACK_FILTER = { ACCEPT: 1, REJECT: 2, SKIP: 3, SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
function resolveNodeFilter(options, rootDoc) {
  const NF = options && options.NodeFilter || (typeof NodeFilter !== "undefined" ? NodeFilter : null) || rootDoc && rootDoc.defaultView && rootDoc.defaultView.NodeFilter || null;
  if (NF && NF.FILTER_ACCEPT !== void 0) {
    return {
      FILTER_ACCEPT: NF.FILTER_ACCEPT,
      FILTER_REJECT: NF.FILTER_REJECT,
      FILTER_SKIP: NF.FILTER_SKIP,
      SHOW_TEXT: NF.SHOW_TEXT !== void 0 ? NF.SHOW_TEXT : 4,
      SHOW_ELEMENT: NF.SHOW_ELEMENT !== void 0 ? NF.SHOW_ELEMENT : 1
    };
  }
  return {
    FILTER_ACCEPT: FALLBACK_FILTER.ACCEPT,
    FILTER_REJECT: FALLBACK_FILTER.REJECT,
    FILTER_SKIP: FALLBACK_FILTER.SKIP,
    SHOW_TEXT: FALLBACK_FILTER.SHOW_TEXT,
    SHOW_ELEMENT: FALLBACK_FILTER.SHOW_ELEMENT
  };
}
function isIgnoredElement(el) {
  if (!el || typeof el.tagName !== "string") return true;
  const tag = el.tagName.toLowerCase();
  if (IGNORED_TAGS.has(tag)) return true;
  try {
    if (el.hidden === true) return true;
    if (typeof el.getAttribute === "function") {
      if (el.getAttribute("hidden") !== null) return true;
      if (el.getAttribute("aria-hidden") === "true") return true;
    }
  } catch {
    return true;
  }
  return false;
}
function siblingIndex(node, sameTagOnly) {
  try {
    const parent = node.parentNode;
    if (!parent || !parent.childNodes) return 1;
    const wantTag = sameTagOnly ? String(node.tagName || "").toLowerCase() : null;
    let index = 0;
    let seen = 0;
    for (const child of parent.childNodes) {
      if (wantTag && String(child.tagName || "").toLowerCase() !== wantTag) continue;
      if (!wantTag && child.nodeType !== node.nodeType) continue;
      index += 1;
      if (child === node) {
        seen = index;
        break;
      }
    }
    return seen || index || 1;
  } catch {
    return 1;
  }
}
function buildDomPath(node) {
  try {
    const parts = [];
    let current = node;
    let depth = 0;
    while (current && current.nodeType !== 9 && depth < 24) {
      if (current.nodeType === 3) {
        parts.unshift(`#text[${siblingIndex(current, false)}]`);
      } else if (current.tagName) {
        parts.unshift(`${String(current.tagName).toLowerCase()}[${siblingIndex(current, true)}]`);
      } else {
        break;
      }
      current = current.parentNode;
      depth += 1;
    }
    return parts.length ? parts.join("/") : `seg-node`;
  } catch {
    return `seg-node`;
  }
}
function nextSegmentId(state) {
  const id = `seg_${String(state.counter).padStart(4, "0")}`;
  state.counter += 1;
  return id;
}
function closestElement(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  if (node.parentElement) return node.parentElement;
  let p = node.parentNode;
  while (p && p.nodeType !== 1) p = p.parentNode;
  return p && p.nodeType === 1 ? p : null;
}
function getFormValue(element) {
  try {
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "select" && typeof element.querySelectorAll === "function") {
      const selected = element.querySelectorAll("option:checked");
      if (selected && selected.length) {
        return Array.from(selected).map((o) => o.textContent !== void 0 ? o.textContent : o.value).join(", ");
      }
    }
    if (typeof element.value === "string") return element.value;
    if (typeof element.getAttribute === "function") {
      return element.getAttribute("value") || "";
    }
    return "";
  } catch {
    return "";
  }
}
function walkRoot(rootNode, rootDoc, NF, state) {
  if (!rootNode || typeof rootDoc.createTreeWalker !== "function") return;
  const whatToShow = NF.SHOW_TEXT | NF.SHOW_ELEMENT;
  const filter = {
    acceptNode(node) {
      try {
        if (node.nodeType === 1) {
          return isIgnoredElement(node) ? NF.FILTER_REJECT : NF.FILTER_ACCEPT;
        }
        if (node.nodeType === 3) {
          const host = closestElement(node);
          if (host && isIgnoredElement(host)) return NF.FILTER_REJECT;
          const value = node.nodeValue ?? "";
          return value && value.trim() ? NF.FILTER_ACCEPT : NF.FILTER_REJECT;
        }
        return NF.FILTER_REJECT;
      } catch {
        return NF.FILTER_REJECT;
      }
    }
  };
  let walker;
  try {
    walker = rootDoc.createTreeWalker(rootNode, whatToShow, filter);
  } catch {
    return;
  }
  const visitElement = (el) => {
    const tag = String(el.tagName || "").toLowerCase();
    try {
      const shadow = el.shadowRoot;
      if (shadow) {
        if (shadow.mode === "open") {
          walkRoot(shadow, rootDoc, NF, state);
        } else {
          state.skipped.shadowRootsClosed += 1;
        }
      } else if (typeof el.attachShadow === "undefined" && el.shadowRoot === void 0) {
      }
    } catch {
      state.skipped.shadowRootsClosed += 1;
    }
    if (tag === "iframe") {
      state.frameCount += 1;
      let childDoc = null;
      let threw = false;
      try {
        childDoc = el.contentDocument || null;
      } catch {
        threw = true;
      }
      if (threw || !childDoc) {
        state.crossOriginFrames.push(el);
      } else {
        const childRoot = childDoc.body || childDoc.documentElement;
        if (childRoot) walkRoot(childRoot, childDoc, NF, state);
        else state.crossOriginFrames.push(el);
      }
      return;
    }
    const tripleKey = (kind, attr) => `${tag}|${kind}|${attr || ""}|${buildDomPath(el)}`;
    if (FORM_VALUE_TAGS.has(tag)) {
      const rawValue = getFormValue(el);
      if (rawValue && String(rawValue).trim()) {
        const key = tripleKey("form_value", "");
        if (!state.seen.has(key)) {
          state.seen.add(key);
          const classification = classifySensitiveField(el);
          const hint = resolveStructuralHint(el);
          state.segments.push({
            id: nextSegmentId(state),
            kind: "form_value",
            tag,
            text: String(rawValue),
            blockRole: getBlockRole(el),
            forceRedact: classification.forceRedact,
            forceReason: classification.reason,
            ...hint ? { structuralHint: hint } : {},
            domPath: buildDomPath(el)
          });
        }
      }
    }
    if (typeof el.getAttribute === "function") {
      for (const attr of ATTRIBUTE_SEGMENT_NAMES) {
        let attrValue = null;
        try {
          attrValue = el.getAttribute(attr);
        } catch {
          attrValue = null;
        }
        if (attrValue && String(attrValue).trim()) {
          const key = tripleKey("attribute", attr);
          if (state.seen.has(key)) continue;
          state.seen.add(key);
          const hint = resolveStructuralHint(el);
          state.segments.push({
            id: nextSegmentId(state),
            kind: "attribute",
            tag,
            attr,
            text: String(attrValue),
            blockRole: getBlockRole(el),
            forceRedact: false,
            ...hint ? { structuralHint: hint } : {},
            domPath: buildDomPath(el)
          });
        }
      }
    }
  };
  try {
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) {
        const host = closestElement(node);
        const key = `__text__||${buildDomPath(node)}`;
        if (!state.seen.has(key)) {
          state.seen.add(key);
          const hint = host ? resolveStructuralHint(host) : void 0;
          state.segments.push({
            id: nextSegmentId(state),
            kind: "text",
            tag: host ? String(host.tagName || "span").toLowerCase() : "span",
            text: String(node.nodeValue ?? ""),
            blockRole: getBlockRole(host),
            forceRedact: false,
            ...hint ? { structuralHint: hint } : {},
            domPath: buildDomPath(node)
          });
        }
      } else if (node.nodeType === 1) {
        visitElement(node);
      }
      node = walker.nextNode();
    }
  } catch {
  }
}
function captureDOMSegments(rootDoc, options) {
  const doc = rootDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) {
    return {
      segments: [],
      skipped: { shadowRootsClosed: 0, iframesCrossOriginUnreachable: 0 },
      frameCount: 0,
      crossOriginFrames: []
    };
  }
  const NF = resolveNodeFilter(options || {}, doc);
  const state = {
    segments: [],
    seen: /* @__PURE__ */ new Set(),
    counter: 0,
    frameCount: 1,
    crossOriginFrames: [],
    skipped: { shadowRootsClosed: 0, iframesCrossOriginUnreachable: 0 }
  };
  const root = doc.body || doc.documentElement || doc;
  walkRoot(root, doc, NF, state);
  state.skipped.iframesCrossOriginUnreachable = state.crossOriginFrames.length;
  return {
    segments: state.segments,
    skipped: state.skipped,
    frameCount: state.frameCount,
    crossOriginFrames: options && options.collectCrossOriginFrames === false ? [] : state.crossOriginFrames
  };
}
function runTier0OnSegments(segments, detector) {
  if (!detector || typeof detector.detectPII !== "function" || typeof detector.redactPII !== "function") {
    throw new Error("runTier0OnSegments requires { detectPII, redactPII } from piidetector.js");
  }
  const segmentResults = [];
  const findings = [];
  for (const segment of segments || []) {
    const structuralHint = segment.structuralHint ? { ...segment.structuralHint } : void 0;
    if (segment.forceRedact) {
      const placeholder = placeholderForForceRedact(
        null,
        segment.forceReason || "input-type-password"
      );
      const type = placeholder === "<CARD_NUMBER>" ? "CARD_NUMBER" : "PASSWORD";
      segmentResults.push({ segment, redactedText: placeholder, detections: [] });
      findings.push({
        type,
        source: "dom",
        confidence: 1,
        ...structuralHint ? { structuralHint } : {},
        segmentId: segment.id,
        forceRedacted: true
      });
      continue;
    }
    const text = String(segment.text ?? "");
    if (!text.trim()) {
      segmentResults.push({ segment, redactedText: text, detections: [] });
      continue;
    }
    const detection = detector.detectPII(text);
    const detections = detection && detection.detections || [];
    const redactedText = detector.redactPII(detection ? detection.text : text, detections);
    segmentResults.push({ segment, redactedText, detections });
    for (const d of detections) {
      findings.push({
        type: d.type,
        source: "dom",
        confidence: d.confidence,
        ...structuralHint ? { structuralHint } : {},
        segmentId: segment.id,
        forceRedacted: false
      });
    }
  }
  return { segmentResults, findings };
}

// src/content/dom-capture-entry.js
var import_piidetector = __toESM(require_piidetector(), 1);
var DETECTOR = { detectPII: import_piidetector.detectPII, redactPII: import_piidetector.redactPII };
var COLLECT_MESSAGE = "__perscope_dom_collect__";
var COLLECT_RESPONSE = "__perscope_dom_response__";
var COLLECT_TIMEOUT_MS = 900;
function isTopFrame() {
  try {
    return typeof window !== "undefined" && window === window.top;
  } catch {
    return false;
  }
}
function captureThisFrame() {
  const rootDoc = typeof document !== "undefined" ? document : null;
  const { segments, skipped } = captureDOMSegments(rootDoc, {
    collectCrossOriginFrames: false
  });
  const { segmentResults, findings } = runTier0OnSegments(segments, DETECTOR);
  const redactedDocument = reconstructDocument(
    segmentResults.map((r) => ({ blockRole: r.segment.blockRole, redactedText: r.redactedText }))
  );
  for (const r of segmentResults) {
    r.segment.text = "";
    r.segment.domPath = "";
  }
  return { segments: segmentResults, findings, redactedDocument, skipped };
}
async function captureAggregated(crossOriginFrames) {
  const local = captureThisFrame();
  const findings = [...local.findings];
  const redactedParts = local.redactedDocument ? [local.redactedDocument] : [];
  const skipped = {
    shadowRootsClosed: local.skipped.shadowRootsClosed,
    iframesCrossOriginUnreachable: 0
  };
  let frameCount = 1;
  const pending = (crossOriginFrames || []).filter((frame) => {
    try {
      return !!(frame && frame.contentWindow && typeof frame.contentWindow.postMessage === "function");
    } catch {
      return false;
    }
  });
  if (!pending.length) {
    return {
      capturedAt: Date.now(),
      frameCount,
      segmentCount: local.segments.length,
      redactedDocument: redactedParts.join("\n\n"),
      findings,
      skipped
    };
  }
  const collectId = `collect_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const responses = await new Promise((resolve) => {
    const byId = /* @__PURE__ */ new Map();
    const onMessage = (event) => {
      try {
        const data = event && event.data;
        if (!data || data.type !== COLLECT_RESPONSE || data.collectId !== collectId) return;
        if (data.result && !byId.has(data.frameToken)) byId.set(data.frameToken, data.result);
      } catch {
      }
    };
    window.addEventListener("message", onMessage);
    pending.forEach((frame, index) => {
      const frameToken = `frame_${index}`;
      try {
        frame.contentWindow.postMessage(
          { type: COLLECT_MESSAGE, collectId, frameToken },
          "*"
        );
      } catch {
      }
    });
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(byId);
    }, COLLECT_TIMEOUT_MS);
  });
  pending.forEach((frame, index) => {
    const frameToken = `frame_${index}`;
    const result = responses.get(frameToken);
    if (!result) {
      skipped.iframesCrossOriginUnreachable += 1;
      return;
    }
    frameCount += 1;
    skipped.shadowRootsClosed += result.skipped ? result.skipped.shadowRootsClosed || 0 : 0;
    if (result.redactedDocument) redactedParts.push(result.redactedDocument);
    for (const f of result.findings || []) findings.push(f);
  });
  return {
    capturedAt: Date.now(),
    frameCount,
    segmentCount: local.segments.length,
    redactedDocument: redactedParts.join("\n\n"),
    findings,
    skipped
  };
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event) => {
    try {
      const data = event && event.data;
      if (!data || data.type !== COLLECT_MESSAGE) return;
      if (isTopFrame()) return;
      const local = captureThisFrame();
      const payload = {
        type: COLLECT_RESPONSE,
        collectId: data.collectId,
        frameToken: data.frameToken,
        result: {
          redactedDocument: local.redactedDocument,
          findings: local.findings,
          skipped: local.skipped
        }
      };
      if (event.source && typeof event.source.postMessage === "function") {
        event.source.postMessage(payload, "*");
      } else if (window.parent && typeof window.parent.postMessage === "function") {
        window.parent.postMessage(payload, "*");
      }
    } catch {
    }
  });
}
if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CAPTURE_DOM_TEXT") return false;
    (async () => {
      try {
        if (isTopFrame()) {
          const { crossOriginFrames } = captureDOMSegments(
            typeof document !== "undefined" ? document : null,
            { collectCrossOriginFrames: true }
          );
          const aggregated = await captureAggregated(crossOriginFrames || []);
          sendResponse({ status: "SUCCESS", capture: aggregated });
        } else {
          const local = captureThisFrame();
          sendResponse({
            status: "SUCCESS",
            capture: {
              capturedAt: Date.now(),
              frameCount: 1,
              segmentCount: local.segments.length,
              redactedDocument: local.redactedDocument,
              findings: local.findings,
              skipped: {
                ...local.skipped,
                iframesCrossOriginUnreachable: 0
              }
            }
          });
        }
      } catch (err) {
        sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  });
}
