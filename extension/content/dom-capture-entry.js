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
    var PII_DEBUG = typeof process !== "undefined" && !!process.env && process.env.PII_DEBUG === "1";
    function debugLog(...args) {
      if (PII_DEBUG) {
        console.log(...args);
      }
    }
    var NER_MODEL_FILE_NAME = "model";
    var NER_MAX_TOKENS = 512;
    var NER_MIN_SCORE = 0.3;
    var nerCache = null;
    async function loadNER() {
      if (nerCache) {
        return nerCache;
      }
      const path = __require("path");
      const fs = __require("fs");
      const NER_MODEL = path.resolve(
        __dirname,
        "models/ettin-68m-nemotron-pii-onnx"
      );
      const {
        AutoTokenizer,
        AutoModelForTokenClassification
      } = await import("@huggingface/transformers");
      let modelId = NER_MODEL;
      try {
        await fs.promises.access(modelId);
      } catch {
        modelId = "rulesentry-io/ettin-68m-nemotron-pii-onnx";
      }
      const tokenizer = await AutoTokenizer.from_pretrained(modelId);
      const model = await AutoModelForTokenClassification.from_pretrained(
        modelId,
        {
          dtype: "fp32",
          model_file_name: NER_MODEL_FILE_NAME,
          // The upstream repo keeps model.onnx at ROOT (no onnx/
          // subfolder); transformers.js defaults subfolder to "onnx",
          // which 404s. Empty string targets the root file.
          subfolder: "",
          device: "cpu"
        }
      );
      const id2label = model.config?.id2label ?? {};
      if (Object.keys(id2label).length === 0) {
        throw new Error("Ettin NER id2label is missing.");
      }
      const configuredMax = Number(
        model.config?.max_position_embeddings ?? NER_MAX_TOKENS
      );
      const maxTokens = Math.min(
        NER_MAX_TOKENS,
        configuredMax > 0 ? configuredMax : NER_MAX_TOKENS
      );
      nerCache = {
        tokenizer,
        model,
        id2label,
        maxTokens
      };
      return nerCache;
    }
    var PATTERNS = {
      // ------------------------------------------------------------------------
      // BASIC PERSONAL INFORMATION
      // ------------------------------------------------------------------------
      EMAIL_ID: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
      // UPI/VPA handles have no dotted TLD (user@okhdfcbank), so the EMAIL_ID
      // pattern above can never match them — they need their own type. The
      // trailing negative lookahead keeps dotted addresses for EMAIL_ID:
      // overlap resolution (same start → longer wins) would also prefer the
      // full email, but excluding them here avoids duplicate candidates.
      UPI_VPA: /\b[a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9-]*(?!\.[a-zA-Z]{2,})\b/g,
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
      BANK_ACCOUNT: /(?<=\b(?:account|a\/c|acct)\s*(?:number|no\.?)?\s*[:\-]?\s*)\d{9,18}\b/gi,
      IBAN: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,
      IFSC_CODE: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
      SWIFT_BIC: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
      // intentionally case-sensitive: BICs are uppercase by spec (was /gi before 79247a3 — author to confirm)
      GSTIN: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Zz][A-Z0-9]\b/gi,
      TAX_ID: /(?<=\b(?:tax\s*(?:id|number)|TIN)\s*[:\-]?\s*)[A-Z0-9-]{6,20}\b/gi,
      // ------------------------------------------------------------------------
      // DEVICE / NETWORK IDENTIFIERS
      // ------------------------------------------------------------------------
      IP_ADDRESS: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      MAC_ADDRESS: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
      DEVICE_ID: /(?<=\b(?:device\s*id|device\s*identifier)\s*[:\-]?\s*)[A-Za-z0-9._:-]{6,50}\b/gi,
      // ------------------------------------------------------------------------
      // AUTHENTICATION / SECRETS
      //
      // Convention for every label-prefixed type below: the label lives in a
      // variable-length lookbehind, so the match span is the VALUE ONLY — the
      // label stays visible after redaction. (V8/Node support unbounded
      // lookbehind; this module is Chrome-or-Node only.)
      // ------------------------------------------------------------------------
      USERNAME: /(?<=\b(?:username|user\s*name|login\s*id)\s*[:\-]?\s*)[A-Za-z0-9._-]{3,40}\b/gi,
      PASSWORD: /(?<=\b(?:password|passwd|pwd)\s*[:=]\s*)\S+/gi,
      PIN: /(?<=\b(?:PIN|pin\s*number)\s*[:\-]?\s*)\d{4,6}\b/g,
      OTP: /(?<=\b(?:OTP|one[-\s]?time\s+password)\s*[:\-]?\s*)\d{4,8}\b/gi,
      API_KEY: /\b(?:api[_\s-]?key|apikey)\s*[:=]\s*[A-Za-z0-9_-]{12,}\b/gi,
      // ------------------------------------------------------------------------
      // ORGANIZATION-SPECIFIC IDENTIFIERS
      // ------------------------------------------------------------------------
      EMPLOYEE_ID: /(?<=\b(?:employee\s*(?:id|number|no\.?))\s*[:\-]?\s*)[A-Za-z0-9-]{4,30}\b/gi,
      CUSTOMER_ID: /(?<=\b(?:customer\s*(?:id|number|no\.?))\s*[:\-]?\s*)[A-Za-z0-9-]{4,30}\b/gi,
      STUDENT_ID: /\b(?:student\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      PATIENT_ID: /\b(?:patient\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,
      POLICY_NUMBER: /\b(?:policy\s*(?:number|no\.?|id))\s*[:\-]?\s*[A-Za-z0-9-]{5,30}\b/gi
    };
    var REPLACEMENTS = {};
    for (const type of Object.keys(PATTERNS)) {
      REPLACEMENTS[type] = `<${type}>`;
    }
    var NER_REPLACEMENTS = {
      ACCOUNT_NUMBER: "<ACCOUNT_NUMBER>",
      AGE: "<AGE>",
      API_KEY: "<API_KEY>",
      BANK_ROUTING_NUMBER: "<BANK_ROUTING_NUMBER>",
      BIOMETRIC_IDENTIFIER: "<BIOMETRIC_IDENTIFIER>",
      BLOOD_TYPE: "<BLOOD_TYPE>",
      CERTIFICATE_LICENSE_NUMBER: "<CERTIFICATE_LICENSE_NUMBER>",
      CITY: "<CITY>",
      COMPANY_NAME: "<COMPANY_NAME>",
      COORDINATE: "<COORDINATE>",
      COUNTRY: "<COUNTRY>",
      COUNTY: "<COUNTY>",
      CREDIT_DEBIT_CARD: "<CREDIT_DEBIT_CARD>",
      CUSTOMER_ID: "<CUSTOMER_ID>",
      CVV: "<CVV>",
      DATE: "<DATE>",
      DATE_OF_BIRTH: "<DATE_OF_BIRTH>",
      DATE_TIME: "<DATE_TIME>",
      DEVICE_IDENTIFIER: "<DEVICE_IDENTIFIER>",
      EDUCATION_LEVEL: "<EDUCATION_LEVEL>",
      EMAIL: "<EMAIL>",
      EMPLOYEE_ID: "<EMPLOYEE_ID>",
      EMPLOYMENT_STATUS: "<EMPLOYMENT_STATUS>",
      FAX_NUMBER: "<FAX_NUMBER>",
      FIRST_NAME: "<FIRST_NAME>",
      GENDER: "<GENDER>",
      HEALTH_PLAN_BENEFICIARY_NUMBER: "<HEALTH_PLAN_BENEFICIARY_NUMBER>",
      HTTP_COOKIE: "<HTTP_COOKIE>",
      IPV4: "<IPV4>",
      IPV6: "<IPV6>",
      LANGUAGE: "<LANGUAGE>",
      LAST_NAME: "<LAST_NAME>",
      LICENSE_PLATE: "<LICENSE_PLATE>",
      MAC_ADDRESS: "<MAC_ADDRESS>",
      MEDICAL_RECORD_NUMBER: "<MEDICAL_RECORD_NUMBER>",
      NATIONAL_ID: "<NATIONAL_ID>",
      OCCUPATION: "<OCCUPATION>",
      PASSWORD: "<PASSWORD>",
      PHONE_NUMBER: "<PHONE_NUMBER>",
      PIN: "<PIN>",
      POLITICAL_VIEW: "<POLITICAL_VIEW>",
      POSTCODE: "<POSTCODE>",
      RACE_ETHNICITY: "<RACE_ETHNICITY>",
      RELIGIOUS_BELIEF: "<RELIGIOUS_BELIEF>",
      SEXUALITY: "<SEXUALITY>",
      SSN: "<SSN>",
      STATE: "<STATE>",
      STREET_ADDRESS: "<STREET_ADDRESS>",
      SWIFT_BIC: "<SWIFT_BIC>",
      TAX_ID: "<TAX_ID>",
      TIME: "<TIME>",
      UNIQUE_ID: "<UNIQUE_ID>",
      URL: "<URL>",
      USER_NAME: "<USER_NAME>",
      VEHICLE_IDENTIFIER: "<VEHICLE_IDENTIFIER>"
    };
    var VERHOEFF_D = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
      [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
      [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
      [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
      [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
      [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    ];
    var VERHOEFF_P = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
      [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 7, 2, 5],
      [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
      [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
      [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
    ];
    function verhoeffCheck(number) {
      const digits = String(number ?? "").replace(/\D/g, "");
      if (digits.length !== 12) return false;
      if (digits[0] === "0" || digits[0] === "1") return false;
      let checksum = 0;
      for (let i = 0; i < digits.length; i++) {
        const digit = Number(digits[digits.length - 1 - i]);
        checksum = VERHOEFF_D[checksum][VERHOEFF_P[i % 8][digit]];
      }
      return checksum === 0;
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
        "UPI_VPA",
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
        "patient",
        "dob",
        "birth",
        "ifsc",
        "upi",
        "vpa",
        "signup",
        "signin",
        "gst",
        "tax"
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
        case "AADHAAR":
          return verhoeffCheck(value);
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
      debugLog(
        "[REDACT] Before:",
        JSON.stringify(result)
      );
      const sorted = [...detections].sort((a, b) => b.start - a.start);
      for (const detection of sorted) {
        const replacement = REPLACEMENTS[detection.type] ?? NER_REPLACEMENTS[detection.type] ?? "<PII>";
        result = result.slice(0, detection.start) + replacement + result.slice(detection.end);
      }
      debugLog(
        "[REDACT] After:",
        JSON.stringify(result)
      );
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
          confidence: detection.confidence,
          source: "regex"
        }))
      };
    }
    async function detectPIIWithNER(text) {
      const residualText = String(text ?? "");
      if (!residualText.trim()) {
        return [];
      }
      const ner = await loadNER();
      console.log("[NER] Running Ettin on Tier-0 residual text");
      const encoded = await ner.tokenizer(
        residualText,
        {
          return_offsets_mapping: true,
          truncation: true,
          max_length: ner.maxTokens
        }
      );
      console.log("[NER] Tokenization complete");
      const output = await ner.model(encoded);
      const logits = output.logits;
      if (!logits) {
        throw new Error("Ettin NER did not return logits.");
      }
      const data = logits.data;
      const dims = logits.dims;
      if (!data || !dims || dims.length < 3) {
        throw new Error("Unexpected Ettin logits shape.");
      }
      const sequenceLength = dims[dims.length - 2];
      const numberOfLabels = dims[dims.length - 1];
      let offsets = encoded.offset_mapping;
      if (offsets?.tolist) {
        offsets = offsets.tolist();
      }
      if (Array.isArray(offsets?.[0])) {
        offsets = offsets[0];
      }
      if (!Array.isArray(offsets)) {
        console.log("[NER] offset_mapping unavailable; building manual offsets");
        const tokens = ner.tokenizer.tokenize(residualText);
        offsets = [[0, 0]];
        let cursor = 0;
        for (const token of tokens) {
          if (!token || token.startsWith("[") || token === "<s>" || token === "</s>") {
            offsets.push([0, 0]);
            continue;
          }
          let cleanToken = token.replace(/^##/, "").replace(/^▁/, "").replace(/^Ġ/, "");
          if (!cleanToken) {
            offsets.push([0, 0]);
            continue;
          }
          let start = residualText.indexOf(
            cleanToken,
            cursor
          );
          if (start === -1) {
            start = residualText.toLowerCase().indexOf(
              cleanToken.toLowerCase(),
              cursor
            );
          }
          if (start === -1) {
            offsets.push([0, 0]);
            continue;
          }
          const end = start + cleanToken.length;
          offsets.push([start, end]);
          cursor = end;
        }
        offsets.push([0, 0]);
      }
      function softmax(values) {
        const max = Math.max(...values);
        const exps = values.map(
          (value) => Math.exp(value - max)
        );
        const sum = exps.reduce(
          (total, value) => total + value,
          0
        );
        return exps.map((value) => value / sum);
      }
      function normalizeLabel(label) {
        const value = String(label ?? "O");
        if (value === "O") {
          return {
            prefix: "O",
            entity: null
          };
        }
        const parts = value.split("-", 2);
        if (parts.length === 2) {
          return {
            prefix: parts[0].toUpperCase(),
            entity: parts[1].toLowerCase()
          };
        }
        return {
          prefix: "B",
          entity: value.toLowerCase()
        };
      }
      const predictions = [];
      for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex++) {
        const tokenStart = offsets[tokenIndex]?.[0] ?? 0;
        const tokenEnd = offsets[tokenIndex]?.[1] ?? 0;
        if (tokenEnd <= tokenStart) {
          continue;
        }
        const tokenLogits = [];
        for (let labelIndex = 0; labelIndex < numberOfLabels; labelIndex++) {
          const index = tokenIndex * numberOfLabels + labelIndex;
          tokenLogits.push(data[index]);
        }
        const probabilities = softmax(tokenLogits);
        let bestLabelIndex = 0;
        for (let labelIndex = 1; labelIndex < probabilities.length; labelIndex++) {
          if (probabilities[labelIndex] > probabilities[bestLabelIndex]) {
            bestLabelIndex = labelIndex;
          }
        }
        const confidence = probabilities[bestLabelIndex];
        const label = ner.id2label[bestLabelIndex] ?? ner.id2label[String(bestLabelIndex)] ?? "O";
        const parsed = normalizeLabel(label);
        if (parsed.prefix === "O" || !parsed.entity || confidence < NER_MIN_SCORE) {
          continue;
        }
        predictions.push({
          prefix: parsed.prefix,
          entity: parsed.entity,
          confidence,
          start: tokenStart,
          end: tokenEnd
        });
      }
      debugLog("[NER] Raw predictions:");
      debugLog(
        predictions.map((prediction) => ({
          entity: prediction.entity,
          prefix: prediction.prefix,
          start: prediction.start,
          end: prediction.end,
          text: residualText.slice(
            prediction.start,
            prediction.end
          ),
          confidence: prediction.confidence
        }))
      );
      const detections = [];
      let current = null;
      for (const prediction of predictions) {
        const predictionType = prediction.entity.toUpperCase();
        const sameEntity = current && current.entity === prediction.entity;
        const adjacent = current && prediction.start <= current.end + 1;
        if (!current || !sameEntity || !adjacent) {
          if (current) {
            detections.push(current);
          }
          current = {
            entity: prediction.entity,
            type: predictionType,
            value: residualText.slice(
              prediction.start,
              prediction.end
            ),
            start: prediction.start,
            end: prediction.end,
            confidence: prediction.confidence,
            source: "ner"
          };
          continue;
        }
        current.end = Math.max(
          current.end,
          prediction.end
        );
        current.value = residualText.slice(
          current.start,
          current.end
        );
        current.confidence = Math.min(
          current.confidence,
          prediction.confidence
        );
      }
      if (current) {
        detections.push(current);
      }
      console.log(
        `[NER] Ettin detected ${detections.length} candidate(s)`
      );
      return stripPlaceholderDetections(detections, residualText);
    }
    function stripPlaceholderDetections(detections, text) {
      const source = String(text ?? "");
      const holes = [];
      const re = /<[A-Z0-9_]+>/g;
      let m;
      while ((m = re.exec(source)) !== null) {
        holes.push([m.index, m.index + m[0].length]);
      }
      if (!holes.length) return detections;
      return (detections || []).filter(
        (d) => !holes.some(
          (h) => d.start < h[1] && d.end > h[0]
        )
      );
    }
    async function processPIIWithNER(text) {
      const tier0Result = processPII(text);
      let finalText = tier0Result.text;
      const nerDetections = await detectPIIWithNER(finalText);
      finalText = redactPII2(
        finalText,
        nerDetections
      );
      const MAX_AUDIT_PASSES = 2;
      const auditDetections = [];
      for (let auditPass = 1; auditPass <= MAX_AUDIT_PASSES; auditPass++) {
        console.log(
          `[SELF-AUDIT] Pass ${auditPass}`
        );
        const auditTier0 = detectPII2(finalText);
        let auditTier1 = [];
        if (auditTier0.text.trim()) {
          auditTier1 = await detectPIIWithNER(finalText);
        }
        const newlyDetected = [
          ...auditTier0.detections,
          ...auditTier1
        ];
        if (newlyDetected.length === 0) {
          console.log(
            "[SELF-AUDIT] Clean after remediation."
          );
          return {
            text: finalText,
            blocked: false,
            detections: [
              ...tier0Result.detections,
              ...nerDetections,
              ...auditDetections
            ]
          };
        }
        console.log(
          `[SELF-AUDIT] Found ${newlyDetected.length} additional candidate(s). Redacting.`
        );
        auditDetections.push(
          ...newlyDetected
        );
        finalText = redactPII2(
          finalText,
          newlyDetected
        );
      }
      console.error(
        "[SELF-AUDIT] Could not reach a clean state. Blocking output."
      );
      return {
        text: null,
        blocked: true,
        reason: "SELF_AUDIT_FAILED",
        detections: [
          ...tier0Result.detections,
          ...nerDetections,
          ...auditDetections
        ]
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
      processPIIWithNER,
      stripPlaceholderDetections,
      extractDOMText,
      extractFormValues
    };
    if (__require.main === module) {
      const readline = __require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });
      const lines = [];
      console.log("\nPaste text to scan.");
      console.log("Type END on a new line when finished.\n");
      rl.on("line", (line) => {
        if (line.trim() === "END") {
          rl.close();
          return;
        }
        lines.push(line);
      });
      rl.on("close", async () => {
        const input = lines.join("\n");
        const result = await processPIIWithNER(input);
        console.log("\nREDACTED:\n");
        console.log(result.text);
        console.log("\nDETECTIONS:\n");
        console.log(
          JSON.stringify(
            result.detections,
            null,
            2
          )
        );
      });
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
function placeholderForForceRedact(element, reason, forcedType) {
  const forced = String(forcedType ?? "");
  if (/^[A-Z0-9_]+$/.test(forced)) return `<${forced}>`;
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
var SECRET_LABEL_VOCABULARY = [
  { match: ["password", "passwd", "pwd", "passcode"], type: "PASSWORD" },
  { match: ["one time password", "one-time password", "otp"], type: "OTP" },
  { match: ["pin number", "pin"], type: "PIN" },
  { match: ["email address", "e-mail", "email"], type: "EMAIL_ID" },
  { match: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"], type: "PHONE_NUMBER" },
  { match: ["upi id", "upi", "vpa"], type: "UPI_VPA" },
  { match: ["account number", "account no", "acct"], type: "BANK_ACCOUNT" },
  { match: ["card number"], type: "CARD_NUMBER" },
  { match: ["ifsc"], type: "IFSC_CODE" },
  { match: ["date of birth", "birth date", "dob"], type: "DATE_OF_BIRTH" },
  { match: ["aadhaar", "aadhar", "uidai"], type: "AADHAAR" },
  { match: ["passport number", "passport no"], type: "PASSPORT_NUMBER" }
];
function normalizeSecretLabel(text) {
  return String(text ?? "").toLowerCase().replace(/[.\-_:;\/\\]+/g, " ").replace(/\s+/g, " ").trim();
}
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var SECRET_LABEL_PATTERNS = SECRET_LABEL_VOCABULARY.map((entry) => {
  const alts = [...entry.match].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return { type: entry.type, re: new RegExp(`\\b(?:${alts.join("|")})\\b`) };
});
function findSecretLabelMatch(text) {
  const norm = normalizeSecretLabel(text);
  if (!norm) return null;
  for (const { type, re } of SECRET_LABEL_PATTERNS) {
    const m = norm.match(re);
    if (m) return { label: m[0], type };
  }
  return null;
}
function isPlausibleValueDom(text) {
  const v = String(text ?? "").trim();
  if (!v || v.length < 2 || v.length > 80) return false;
  if (!/[a-z0-9]/i.test(v)) return false;
  if (/^[.,:;\/\-_]+$/.test(v)) return false;
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  if (words.length > 4 && /^[a-z\s.,?()'""]+$/i.test(v) && !/[\d@/_-]/.test(v)) return false;
  return true;
}
function isBareLabelSegment(text) {
  const norm = normalizeSecretLabel(text);
  if (!norm || norm.length > 60) return null;
  const hit = findSecretLabelMatch(norm);
  if (!hit) return null;
  const remainder = norm.replace(hit.label, "").replace(/[:\s]+/g, " ").trim();
  if (remainder && isPlausibleValueDom(remainder)) return null;
  return hit;
}
function hintTexts(hint) {
  if (!hint || typeof hint !== "object") return [];
  return [hint.labelText, hint.fieldName].filter((s) => typeof s === "string" && s.trim());
}
function associateLabelValues(segments) {
  const input = Array.isArray(segments) ? segments : [];
  const out = [];
  const consumed = /* @__PURE__ */ new Set();
  const pushValue = (seg, index, forcedType, forceReason) => {
    consumed.add(index);
    out.push({ ...seg, forceRedact: true, forceReason, forcedType });
  };
  for (let i = 0; i < input.length; i++) {
    const seg = input[i];
    if (!seg || typeof seg !== "object") continue;
    if (consumed.has(i)) continue;
    if (seg.kind === "form_value" && !seg.forceRedact && seg.structuralHint) {
      const hintHit = findSecretLabelMatch(hintTexts(seg.structuralHint).join(" ")) || null;
      if (hintHit) {
        pushValue(seg, i, hintHit.type, `label-hint-${hintHit.label.replace(/\s+/g, "-")}`);
        continue;
      }
      out.push(seg);
      continue;
    }
    if (seg.kind !== "text" && seg.kind !== "attribute") {
      out.push(seg);
      continue;
    }
    const split = splitLabelValueSegment(seg);
    if (split) {
      out.push(split.labelSeg, split.valueSeg);
      continue;
    }
    const bare = isBareLabelSegment(String(seg.text ?? ""));
    if (bare) {
      const target = nextSameBlockValue(input, i);
      if (target) {
        out.push(seg);
        pushValue(target.seg, target.index, bare.type, `label-associated-neighbor:${bare.label.replace(/\s+/g, "-")}`);
        continue;
      }
      out.push(seg);
      continue;
    }
    out.push(seg);
  }
  return associateTableGroups(out);
}
function splitLabelValueSegment(seg) {
  const text = String(seg.text ?? "");
  const m = text.match(/^(.+?)\s*[:\uFF1A]\s*(.+)$/) || text.match(/^(.+?)\s{2,}(.+)$/);
  if (!m) return null;
  const labelPart = m[1].trim();
  const valuePart = m[2].trim();
  if (!labelPart || !valuePart) return null;
  if (labelPart.length > 60) return null;
  const hit = findSecretLabelMatch(labelPart);
  if (!hit) return null;
  if (!isPlausibleValueDom(valuePart)) return null;
  const valueLabelHit = findSecretLabelMatch(valuePart);
  if (valueLabelHit && !isPlausibleValueDom(valuePart.replace(valueLabelHit.label, ""))) {
    return null;
  }
  return {
    labelSeg: { ...seg, id: `${seg.id}~label`, text: labelPart },
    valueSeg: {
      ...seg,
      id: `${seg.id}~value`,
      text: valuePart,
      forceRedact: true,
      forceReason: `label-associated-split:${hit.label.replace(/\s+/g, "-")}`,
      forcedType: hit.type
    }
  };
}
function nextSameBlockValue(segments, fromIndex) {
  const labelSeg = segments[fromIndex];
  const labelText = String(labelSeg.text ?? "");
  const colonTerminated = /[:\uFF1A]\s*$/.test(labelText.trim());
  const scope = scopeKey(labelSeg);
  let skippedNav = 0;
  let skippedLabel = 0;
  let crossedScope = false;
  let afterCross = 0;
  let seenDots = false;
  for (let j = fromIndex + 1; j < segments.length; j++) {
    const cand = segments[j];
    if (!cand || typeof cand !== "object") continue;
    if (scopeKey(cand) !== scope) {
      if (cand.kind === "form_value") return { seg: cand, index: j };
      crossedScope = true;
    } else if (crossedScope) {
      afterCross += 1;
      if (afterCross > 6) return null;
    }
    if (cand.kind === "form_value") return { seg: cand, index: j };
    if (cand.kind === "text" || cand.kind === "attribute") {
      const candText = String(cand.text ?? "").trim();
      if (!candText) continue;
      if (/[•*]{4,}/.test(candText)) {
        seenDots = true;
        continue;
      }
      const candTag = String(cand.tag || "");
      if (candTag === "a" || candTag === "button") {
        skippedNav += 1;
        if (skippedNav + skippedLabel > 3) return null;
        continue;
      }
      if (isBareLabelSegment(candText)) {
        skippedLabel += 1;
        if (skippedNav + skippedLabel > 3) return null;
        continue;
      }
      if (!isPlausibleValueDom(candText)) {
        if (candText.length <= 20) continue;
        return null;
      }
      if (!colonTerminated && (skippedNav === 0 || skippedLabel > 0)) {
        if (!(crossedScope && (seenDots || dotsAhead(segments, j)))) return null;
      }
      return { seg: cand, index: j };
    }
    return null;
  }
  return null;
}
function dotsAhead(segments, fromIndex) {
  for (let k = fromIndex; k <= fromIndex + 3 && k < segments.length; k++) {
    const seg = segments[k];
    if (seg && typeof seg === "object" && /[•*]{4,}/.test(String(seg.text ?? ""))) return true;
  }
  return false;
}
function scopeKey(seg) {
  const parts = String(seg.domPath ?? "").split("/");
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(0, -2).join("/");
}
function associateTableGroups(segments) {
  const forced = /* @__PURE__ */ new Set();
  const forceTypeAt = /* @__PURE__ */ new Map();
  const force = (index, type, label) => {
    const seg = segments[index];
    if (!seg || seg.forceRedact || forced.has(index)) return;
    if (!isPlausibleValueDom(String(seg.text ?? ""))) return;
    forced.add(index);
    forceTypeAt.set(index, { type, label });
  };
  segments.forEach((seg, index) => {
    if (!seg || typeof seg !== "object" || seg.forceRedact) return;
    const header = seg.structuralHint && typeof seg.structuralHint.tableHeader === "string" ? seg.structuralHint.tableHeader : "";
    if (header) {
      const hit = findSecretLabelMatch(header);
      if (hit && seg.tag !== "th" && String(seg.text ?? "").trim() !== header.trim()) {
        force(index, hit.type, hit.label);
        return;
      }
    }
    if (seg.tag === "th") {
      const hit = findSecretLabelMatch(String(seg.text ?? ""));
      if (!hit) return;
      const rowPrefix = trPrefix(seg.domPath);
      if (!rowPrefix) return;
      for (let j = index + 1; j < segments.length; j++) {
        const cand = segments[j];
        if (!cand || typeof cand !== "object") continue;
        if (trPrefix(cand.domPath) !== rowPrefix) break;
        if (cand.tag === "td" || cand.kind === "form_value") {
          force(j, hit.type, hit.label);
          break;
        }
      }
    }
  });
  if (!forced.size) return segments;
  return segments.map((seg, index) => {
    if (!forced.has(index)) return seg;
    const { type, label } = forceTypeAt.get(index);
    return { ...seg, forceRedact: true, forceReason: `label-associated-table:${label.replace(/\s+/g, "-")}`, forcedType: type };
  });
}
function trPrefix(domPath) {
  const m = String(domPath ?? "").match(/^(.*\/tr\[\d+\])/);
  return m ? m[1] : null;
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
        segment.forceReason || "input-type-password",
        segment.forcedType
      );
      const type = segment.forcedType || (placeholder === "<CARD_NUMBER>" ? "CARD_NUMBER" : "PASSWORD");
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

// src/content/refs.js
var registry = /* @__PURE__ */ new Map();
var counter = 0;
var INTERACTIVE_TAGS = /* @__PURE__ */ new Set(["a", "button", "input", "textarea", "select"]);
function isSkippable(el) {
  if (!el || typeof el.tagName !== "string") return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") return true;
  if (tag === "input") {
    const type = String(el.getAttribute ? el.getAttribute("type") : el.type || "text").trim().toLowerCase();
    if (type === "hidden") return true;
  }
  if (el.hidden) return true;
  try {
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
  } catch {
  }
  return false;
}
function isInteractive(el) {
  if (isSkippable(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) {
    if (tag === "a") {
      try {
        if (!el.getAttribute || !el.getAttribute("href")) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  try {
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "button" || role === "link") return true;
  } catch {
  }
  return false;
}
function textOf2(el, maxLen = 60) {
  try {
    const t = String(el.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  } catch {
    return "";
  }
}
function elementLabel(el) {
  try {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && String(aria).trim()) return String(aria).trim().slice(0, 60);
  } catch {
  }
  try {
    const doc = el.ownerDocument;
    const id = el.getAttribute && el.getAttribute("id");
    if (id && doc && typeof doc.querySelector === "function") {
      const label = doc.querySelector(`label[for="${String(id).replace(/"/g, "")}"]`);
      const labelText = label && String(label.textContent ?? "").replace(/\s+/g, " ").trim();
      if (labelText) return labelText.slice(0, 60);
    }
  } catch {
  }
  const text = textOf2(el);
  if (text) return text;
  try {
    for (const attr of ["value", "placeholder", "name", "title"]) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && String(v).trim()) return String(v).trim().slice(0, 60);
    }
  } catch {
  }
  return "";
}
function elementRole(el) {
  const tag = String(el.tagName || "").toLowerCase();
  try {
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "button" || role === "link") return role;
  } catch {
  }
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = String(el.getAttribute ? el.getAttribute("type") : el.type || "text").trim().toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  }
  return tag;
}
function identityOf(el) {
  let idAttr = null;
  let nameAttr = null;
  try {
    idAttr = el.getAttribute ? el.getAttribute("id") : null;
    nameAttr = el.getAttribute ? el.getAttribute("name") : null;
  } catch {
  }
  return {
    idAttr: idAttr != null ? String(idAttr) : null,
    nameAttr: nameAttr != null ? String(nameAttr) : null
  };
}
function collectInteractive(root) {
  const found = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      if (isInteractive(node)) found.push(node);
      const tag = String(node.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;
    }
    const children = node.childNodes || [];
    for (const child of children) visit(child);
  };
  const start = root && root.nodeType === 9 ? root.documentElement || root : root;
  visit(start);
  return found;
}
function enumerateInteractive(rootDoc) {
  const seenPaths = /* @__PURE__ */ new Set();
  const out = [];
  for (const el of collectInteractive(rootDoc)) {
    const domPath = buildDomPath(el);
    const tag = String(el.tagName || "").toLowerCase();
    const label = elementLabel(el);
    const role = elementRole(el);
    const { idAttr, nameAttr } = identityOf(el);
    const key = `${domPath}|${tag}`;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    let ref = null;
    for (const [existingRef, record] of registry) {
      if (record.domPath === domPath && record.tag === tag) {
        ref = existingRef;
        record.label = label;
        record.idAttr = idAttr;
        record.nameAttr = nameAttr;
        break;
      }
    }
    if (!ref) {
      counter += 1;
      ref = `el_${counter}`;
      registry.set(ref, { domPath, tag, label, idAttr, nameAttr });
    }
    out.push({ ref, tag, label, role });
  }
  return out;
}
function resolveRef(rootDoc, ref) {
  const record = registry.get(ref);
  if (!record) return { stale: true, reason: "unknown-ref" };
  const element = walkDomPath(rootDoc, record.domPath);
  if (!element || element.nodeType !== 1) {
    return { stale: true, reason: "stale_element" };
  }
  if (String(element.tagName || "").toLowerCase() !== record.tag) {
    return { stale: true, reason: "stale_element" };
  }
  const current = identityOf(element);
  if (record.idAttr != null && current.idAttr !== record.idAttr) {
    return { stale: true, reason: "stale_element" };
  }
  if (record.nameAttr != null && current.nameAttr !== record.nameAttr) {
    return { stale: true, reason: "stale_element" };
  }
  return { element };
}
function childElements(node) {
  const out = [];
  for (const child of node.childNodes || []) {
    if (child && child.nodeType === 1) out.push(child);
  }
  return out;
}
function walkDomPath(rootDoc, domPath) {
  const parts = String(domPath ?? "").split("/");
  if (!parts.length) return null;
  let node = rootDoc && rootDoc.nodeType === 9 ? rootDoc.documentElement || rootDoc : rootDoc;
  if (!node) return null;
  let startIndex = 0;
  const first = parts[0].match(/^([a-z0-9]+)\[(\d+)\]$/i);
  if (first && node.tagName && String(node.tagName).toLowerCase() === first[1].toLowerCase()) {
    startIndex = 1;
  }
  for (let i = startIndex; i < parts.length; i++) {
    const m = parts[i].match(/^([a-z0-9]+)\[(\d+)\]$/i);
    if (!m) {
      if (parts[i].startsWith("#text")) return null;
      return null;
    }
    const [, tag, indexStr] = m;
    const siblings = childElements(node).filter(
      (c) => String(c.tagName || "").toLowerCase() === tag.toLowerCase()
    );
    node = siblings[Number(indexStr) - 1] ?? null;
    if (!node) return null;
  }
  return node;
}

// src/content/actions.js
var REF_TOOLS = /* @__PURE__ */ new Set(["click", "type", "select_option", "submit"]);
function visibleText(el, maxLen = 120) {
  try {
    const t = String(el.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  } catch {
    return "";
  }
}
function inputTypeOf(el) {
  try {
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input") {
      return String(
        el.getAttribute && el.getAttribute("type") || el.type || "text"
      ).trim().toLowerCase();
    }
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
  } catch {
  }
  return "";
}
function isSubmitControl(el) {
  try {
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input") {
      const t = inputTypeOf(el);
      return t === "submit" || t === "image";
    }
    if (tag === "button") {
      const t = String(el.getAttribute && el.getAttribute("type") || "").trim().toLowerCase();
      if (!t) return !!owningForm(el);
      return t === "submit";
    }
  } catch {
  }
  return false;
}
function owningForm(el) {
  try {
    if (el && typeof el.form !== "undefined" && el.form) return el.form;
    let node = el ? el.parentNode : null;
    while (node) {
      if (node.nodeType === 1 && String(node.tagName || "").toLowerCase() === "form") return node;
      node = node.parentNode;
    }
  } catch {
  }
  return null;
}
function setFieldValue(el, value) {
  const text = String(value ?? "");
  try {
    const proto = String(el.tagName || "").toLowerCase() === "textarea" ? Object.getPrototypeOf(el) || null : null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
  } catch {
    try {
      el.value = text;
    } catch {
      return false;
    }
  }
  for (const type of ["input", "change"]) {
    try {
      if (typeof el.dispatchEvent === "function") {
        const Ctor = typeof window !== "undefined" && window.Event || (typeof Event !== "undefined" ? Event : null);
        if (Ctor) el.dispatchEvent(new Ctor(type, { bubbles: true }));
      }
    } catch {
    }
  }
  return true;
}
function previewAction(rootDoc, { tool, ref } = {}) {
  if (tool === "scroll") {
    return { ok: true, signals: { tool, ref: null, tag: "", label: "", text: "", inputType: "", isFormSubmit: false } };
  }
  if (!REF_TOOLS.has(tool)) return { ok: false, reason: "unsupported-tool" };
  if (typeof ref !== "string" || !ref) return { ok: false, reason: "unknown-ref" };
  const resolved = resolveRef(rootDoc, ref);
  if (!resolved || !resolved.element) {
    return { ok: false, reason: resolved && resolved.reason || "stale_element" };
  }
  const el = resolved.element;
  const tag = String(el.tagName || "").toLowerCase();
  return {
    ok: true,
    signals: {
      tool,
      ref,
      tag,
      label: elementLabel(el),
      text: tag === "input" || tag === "textarea" || tag === "select" ? "" : visibleText(el),
      inputType: inputTypeOf(el),
      isFormSubmit: tool === "submit" || isSubmitControl(el)
    }
  };
}
function executeAction(rootDoc, win, { tool, ref, text, value, direction, amount } = {}) {
  if (tool === "scroll") {
    if (direction !== "up" && direction !== "down") return { ok: false, reason: "bad-arguments" };
    const dy = Number.isInteger(amount) && amount > 0 ? amount : 800;
    try {
      const target = win || (typeof window !== "undefined" ? window : null);
      if (!target || typeof target.scrollBy !== "function") return { ok: false, reason: "unsupported-tool" };
      target.scrollBy({ top: direction === "down" ? dy : -dy, behavior: "auto" });
      return { ok: true };
    } catch {
      return { ok: false, reason: "unsupported-tool" };
    }
  }
  if (!REF_TOOLS.has(tool)) return { ok: false, reason: "unsupported-tool" };
  if (typeof ref !== "string" || !ref) return { ok: false, reason: "unknown-ref" };
  const resolved = resolveRef(rootDoc, ref);
  if (!resolved || !resolved.element) {
    return { ok: false, reason: resolved && resolved.reason || "stale_element" };
  }
  const el = resolved.element;
  const tag = String(el.tagName || "").toLowerCase();
  try {
    if (tool === "click") {
      if (typeof el.click === "function") el.click();
      else return { ok: false, reason: "unsupported-tool" };
      return { ok: true, ref };
    }
    if (tool === "type") {
      if (typeof text !== "string") return { ok: false, reason: "bad-arguments" };
      const kind = inputTypeOf(el);
      const typeable = tag === "textarea" || tag === "input" && ["text", "search", "email", "tel", "url", "password", "number"].includes(kind);
      if (!typeable) return { ok: false, reason: "not-typeable" };
      try {
        if (typeof el.focus === "function") el.focus();
      } catch {
      }
      if (!setFieldValue(el, text)) return { ok: false, reason: "not-typeable" };
      return { ok: true, ref };
    }
    if (tool === "select_option") {
      if (tag !== "select") return { ok: false, reason: "not-typeable" };
      if (typeof value !== "string") return { ok: false, reason: "bad-arguments" };
      if (!setFieldValue(el, value)) return { ok: false, reason: "not-typeable" };
      if (String(el.value ?? "") !== value) return { ok: false, reason: "invalid-option" };
      return { ok: true, ref };
    }
    if (tool === "submit") {
      const form = tag === "form" ? el : owningForm(el);
      if (!form) return { ok: false, reason: "no-form" };
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else if (typeof form.submit === "function") form.submit();
      else return { ok: false, reason: "no-form" };
      return { ok: true, ref };
    }
  } catch {
    return { ok: false, reason: "unsupported-tool" };
  }
  return { ok: false, reason: "unsupported-tool" };
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
  const associated = associateLabelValues(segments);
  const { segmentResults, findings } = runTier0OnSegments(associated, DETECTOR);
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
    if (!message) return false;
    if (message.type === "LIST_ELEMENTS") {
      try {
        const elements = enumerateInteractive(
          typeof document !== "undefined" ? document : null
        );
        sendResponse({ status: "SUCCESS", elements });
      } catch (err) {
        sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
      }
      return true;
    }
    if (message.type !== "CAPTURE_DOM_TEXT") {
      if (message.type === "PREVIEW_ACTION") {
        try {
          const preview = previewAction(
            typeof document !== "undefined" ? document : null,
            { tool: message.tool, ref: message.ref }
          );
          if (preview.ok) sendResponse({ status: "SUCCESS", preview: preview.signals });
          else sendResponse({ status: "ERROR", error: preview.reason });
        } catch (err) {
          sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
        }
        return true;
      }
      if (message.type === "EXECUTE_ACTION") {
        try {
          const result = executeAction(
            typeof document !== "undefined" ? document : null,
            typeof window !== "undefined" ? window : null,
            {
              tool: message.tool,
              ref: message.ref,
              text: message.text,
              value: message.value,
              direction: message.direction,
              amount: message.amount
            }
          );
          if (result.ok) sendResponse({ status: "SUCCESS", result: { ref: result.ref ?? null } });
          else sendResponse({ status: "ERROR", error: result.reason });
        } catch (err) {
          sendResponse({ status: "ERROR", error: err && err.message ? err.message : String(err) });
        }
        return true;
      }
      return false;
    }
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
