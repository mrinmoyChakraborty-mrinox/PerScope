/**
 * PerScope DOM Capture — Structural Heuristics (browser-only)
 *
 * Read-only helpers for the DOM snapshot pipeline. This module never mutates
 * the DOM, never performs PII detection itself, and never changes Tier0
 * confidence scoring — it only resolves *structural context* that travels
 * alongside Koyel's `detectPII` confidence as supplementary metadata.
 *
 * Data flow:
 *   dom-capture.js builds segments -> classifySensitiveField() pre-classifies
 *   password/hidden fields (always-redact, outside tiering) -> per-segment
 *   detectPII(text) (piidetector.js, unmodified) -> findings gain a sibling
 *   `structuralHint` field (her `confidence` is never overwritten) ->
 *   reconstructDocument() rebuilds block-aware redacted text.
 */

export const AUTOCOMPLETE_TO_PII = {
  email: "EMAIL_ID",
  username: "USERNAME",
  "current-password": "PASSWORD",
  "new-password": "PASSWORD",
  tel: "PHONE_NUMBER",
  "tel-country-code": "PHONE_NUMBER",
  "tel-national": "PHONE_NUMBER",
  "cc-number": "CARD_NUMBER",
  "cc-csc": "PASSWORD",
  "cc-exp": "DATE_OF_BIRTH",
  bday: "DATE_OF_BIRTH",
  "street-address": "STREET_ADDRESS",
  "address-line1": "STREET_ADDRESS",
  "address-line2": "STREET_ADDRESS",
  "postal-code": "POSTAL_CODE",
  country: "COUNTRY",
  name: "PERSON_NAME",
  "given-name": "PERSON_NAME",
  "family-name": "PERSON_NAME",
  nickname: "PERSON_NAME",
  organization: "ORGANIZATION",
  "cc-name": "PERSON_NAME",
  "transaction-amount": "BANK_ACCOUNT",
};

/**
 * Autocomplete tokens whose values must be redacted unconditionally.
 * Password-field masking is always-on, outside tiering: there is no reliable
 * text signature for a secret, so pattern matching must not be consulted.
 */
export const FORCE_REDACT_AUTOCOMPLETE = new Set([
  "current-password",
  "new-password",
  "cc-csc",
  "cc-number",
]);

/**
 * Map a raw `autocomplete` attribute value to a PII type hint.
 * Supplementary metadata only — never skips or overrides detectPII.
 */
export function mapAutocompleteToType(value) {
  if (value === null || value === undefined) return undefined;
  const token = String(value).trim().toLowerCase().split(/\s+/).pop();
  if (!token) return undefined;
  return AUTOCOMPLETE_TO_PII[token];
}

/**
 * Pre-classification for form controls. Runs BEFORE a value segment is built:
 * forced segments skip detectPII entirely and go straight to a placeholder.
 *
 * @param {Element} element form control element (input/textarea/select)
 * @returns {{ forceRedact: boolean, reason: string }}
 */
export function classifySensitiveField(element) {
  if (!element || typeof element.tagName !== "string") {
    return { forceRedact: false, reason: "not-an-element" };
  }
  const tag = element.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return { forceRedact: false, reason: "not-a-form-control" };
  }
  const type = String(element.getAttribute ? element.getAttribute("type") : element.type || "")
    .trim()
    .toLowerCase();
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

/**
 * Placeholder for force-redacted values. Reuses the `<TYPE>` convention from
 * piidetector.js REPLACEMENTS — no new format is invented. When association
 * supplies a forcedType (a piidetector PATTERNS key), it names the
 * placeholder directly.
 */
export function placeholderForForceRedact(element, reason, forcedType) {
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

/**
 * Resolve structural context for an element. Pure read-only DOM queries.
 *
 * @param {Element} element
 * @returns {{ labelText?: string, autocompleteType?: string, fieldName?: string, tableHeader?: string }|undefined}
 */
export function resolveStructuralHint(element) {
  if (!element) return undefined;
  const hint = {};
  const doc = element.ownerDocument || (typeof document !== "undefined" ? document : null);

  // 1. <label for=id> association.
  try {
    const id = element.getAttribute ? element.getAttribute("id") : element.id;
    if (id && doc && typeof doc.querySelector === "function") {
      const label = doc.querySelector(`label[for="${String(id).replace(/"/g, "")}"]`);
      const labelText = collapseWhitespace(textOf(label));
      if (labelText) hint.labelText = labelText;
    }
    // Wrapped label: <label> text <input> </label>
    if (!hint.labelText && typeof element.closest === "function") {
      const wrapped = element.closest("label");
      const wrappedText = collapseWhitespace(textOf(wrapped));
      if (wrappedText) hint.labelText = wrappedText;
    }
  } catch {
    // label lookup is best-effort; never fail capture.
  }

  // 2. aria-labelledby target text.
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
    // best-effort
  }

  // 3. autocomplete raw value + name/id secondary hint.
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
    // best-effort
  }

  // 4. Table header association for <td> cells.
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
    // Text nodes / inline elements inside a td inherit the cell's header.
    if (!hint.tableHeader && typeof element.closest === "function") {
      const cell = element.closest("td");
      if (cell && cell !== element) {
        const cellHint = resolveStructuralHint(cell);
        if (cellHint && cellHint.tableHeader) hint.tableHeader = cellHint.tableHeader;
      }
    }
  } catch {
    // best-effort
  }

  return Object.keys(hint).length ? hint : undefined;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const PARAGRAPH_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre",
  "figcaption",
  "address",
]);

/**
 * Block role drives line-break decisions in reconstructDocument().
 * @param {Element|null} element closest element for the segment
 */
export function getBlockRole(element) {
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

/**
 * Rebuild block-aware readable text from already-redacted segment texts in
 * document order. Double newline for paragraph/heading boundaries, single
 * newline for list items / table rows / table cells.
 *
 * @param {Array<{ blockRole: string, redactedText: string }>} segments
 * @returns {string}
 */
export function reconstructDocument(segments) {
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
      // inline: append to current line with a space.
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
  // Collapse accidental triple+ newlines; trim trailing blank.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

/* ============================================================================
 * LABEL → VALUE ASSOCIATION (derived from the image-flow relation mapper)
 * ============================================================================
 *
 * Image pipeline (heuristics.js): OCR boxes -> reading-order rows ->
 * SENSITIVE_FIELD_VOCABULARY label match -> value box in same line /
 * side-by-side row / vertical row -> redact the VALUE box only.
 *
 * DOM equivalent here: segments already arrive in document order (the DOM
 * reading order — no bbox clustering needed) with blockRole containers
 * (the DOM row equivalent) and structuralHint label linkage (the DOM
 * equivalent of spatial adjacency). Three geometries mirror the image three:
 *   same-segment  ("Label: value" split)  <-> extractLabelValueSameLine
 *   neighbor      (label seg -> next seg)  <-> extractLabelValueSideBySide
 *   table/form    (hint-linked or grouped) <-> extractLabelValueVertical
 *
 * Value-only principle preserved throughout: label segments are NEVER
 * modified — only the value side is force-marked. Deliberate differences
 * from image (not omissions): no OCR-error tolerance (0->o swaps) and no
 * fuzzy matching, because DOM text is exact.
 */

/**
 * Secret-label vocabulary. piidetector PATTERNS keys are used as `type` so
 * placeholders stay in the single `<TYPE>` convention — no new format.
 * (The image SENSITIVE_FIELD_VOCABULARY is the canonical superset for
 * document-style labels; the password/secret family here is DOM-first.)
 */
export const SECRET_LABEL_VOCABULARY = [
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
  { match: ["passport number", "passport no"], type: "PASSPORT_NUMBER" },
];

function normalizeSecretLabel(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[.\-_:;\/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SECRET_LABEL_PATTERNS = SECRET_LABEL_VOCABULARY.map((entry) => {
  const alts = [...entry.match].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return { type: entry.type, re: new RegExp(`\\b(?:${alts.join("|")})\\b`) };
});

/**
 * Match secret-label vocabulary against free text. Returns
 * { label, type } on first (longest-phrase-first) hit, else null.
 */
export function findSecretLabelMatch(text) {
  const norm = normalizeSecretLabel(text);
  if (!norm) return null;
  for (const { type, re } of SECRET_LABEL_PATTERNS) {
    const m = norm.match(re);
    if (m) return { label: m[0], type };
  }
  return null;
}

/**
 * DOM mirror of the image isPlausibleValue guards: rejects empties,
 * punctuation-only strings, overlong blobs, and long pure-alpha prose.
 */
export function isPlausibleValueDom(text) {
  const v = String(text ?? "").trim();
  if (!v || v.length < 2 || v.length > 80) return false;
  if (!/[a-z0-9]/i.test(v)) return false;
  if (/^[.,:;\/\-_]+$/.test(v)) return false;
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  if (words.length > 4 && /^[a-z\s.,?()'""]+$/i.test(v) && !/[\d@/_-]/.test(v)) return false;
  return true;
}

/**
 * True when a text segment IS a bare label (e.g. "Password:"), i.e. it
 * matches secret vocabulary and carries no plausible value of its own.
 */
export function isBareLabelSegment(text) {
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

/**
 * Associate label segments with their value segments (value-only).
 *
 * Input: segments from captureDOMSegments (never mutated — a new array is
 * returned; split pieces get derived `${id}~label` / `${id}~value` ids).
 * Output: same segments, plus forceRedact/forceReason/forcedType set ONLY
 * on value sides. Label sides are untouched, always.
 *
 * Order mirrors Tier0-before-NER layering: association runs BEFORE
 * runTier0OnSegments, so associated secrets skip pattern matching entirely
 * (random strings have no pattern signature — matching would miss them).
 */
export function associateLabelValues(segments) {
  const input = Array.isArray(segments) ? segments : [];
  const out = [];
  const consumed = new Set();
  const pushValue = (seg, index, forcedType, forceReason) => {
    consumed.add(index);
    out.push({ ...seg, forceRedact: true, forceReason, forcedType });
  };

  for (let i = 0; i < input.length; i++) {
    const seg = input[i];
    if (!seg || typeof seg !== "object") continue;
    // Value already emitted as a forced copy by an earlier label's scan:
    // drop the original (emitting it again would duplicate + leak it).
    // Skipped navigational/label segments are NOT consumed — they flow
    // through normally when reached, so links and labels stay visible.
    if (consumed.has(i)) continue;

    // Pass A — direct hint pairing (form values whose own label context is
    // secret): the reported password-leak shape (visible fields with
    // labelText but non-password type/autocomplete).
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

    // Pass B — same-segment split ("Label: value" / "Label  value").
    const split = splitLabelValueSegment(seg);
    if (split) {
      out.push(split.labelSeg, split.valueSeg);
      continue;
    }

    // Pass C — bare-label neighbor (label seg -> next same-block value).
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

  // Pass D — table groups: key segment + next segment sharing a tableHeader.
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
    return null; // value side is itself just a label — leave for neighbor pass
  }
  return {
    labelSeg: { ...seg, id: `${seg.id}~label`, text: labelPart },
    valueSeg: {
      ...seg,
      id: `${seg.id}~value`,
      text: valuePart,
      forceRedact: true,
      forceReason: `label-associated-split:${hit.label.replace(/\s+/g, "-")}`,
      forcedType: hit.type,
    },
  };
}

function nextSameBlockValue(segments, fromIndex) {
  const labelSeg = segments[fromIndex];
  const labelText = String(labelSeg.text ?? "");
  const colonTerminated = /[:\uFF1A]\s*$/.test(labelText.trim());
  // Association scope is the nearest shared container (domPath minus the
  // host element + text node), NOT blockRole: sibling divs/links under one
  // form share a scope even though their roles differ (paragraph vs
  // inline). blockRole still drives rebuild newlines elsewhere.
  const scope = scopeKey(labelSeg);
  let skippedNav = 0;
  let skippedLabel = 0;
  // Cross-scope state (the custom-password-component leak): a bare secret
  // label in one container with its value rendered as plain text in a
  // sibling container. Tracked — never assumed — and only ever resolved
  // through the dots-adjacency gate at the bottom, so greetings/prose
  // after a secret header are still left alone.
  let crossedScope = false;
  let afterCross = 0;
  let seenDots = false;
  for (let j = fromIndex + 1; j < segments.length; j++) {
    const cand = segments[j];
    if (!cand || typeof cand !== "object") continue;
    if (scopeKey(cand) !== scope) {
      // Different container: a directly-linked form value still counts
      // immediately (strongly typed association, scope-immune).
      if (cand.kind === "form_value") return { seg: cand, index: j };
      crossedScope = true;
    } else if (crossedScope) {
      // Bounded reach past the boundary: the value must be NEAR the label.
      afterCross += 1;
      if (afterCross > 6) return null;
    }
    if (cand.kind === "form_value") return { seg: cand, index: j };
    if (cand.kind === "text" || cand.kind === "attribute") {
      const candText = String(cand.text ?? "").trim();
      if (!candText) continue;
      // Mask-dot runs (custom password components render •/*** next to a
      // shown value) are recorded, never taken as values themselves.
      if (/[•*]{4,}/.test(candText)) {
        seenDots = true;
        continue;
      }
      const candTag = String(cand.tag || "");
      // Navigational elements (links/buttons) are UI chrome, never secret
      // values: step over them (cap the gap). This is the reported login
      // shape — label, "Forgot password?" link, then the value.
      if (candTag === "a" || candTag === "button") {
        skippedNav += 1;
        if (skippedNav + skippedLabel > 3) return null;
        continue;
      }
      if (isBareLabelSegment(candText)) {
        skippedLabel += 1;
        if (skippedNav + skippedLabel > 3) return null;
        continue; // another label — keep scanning
      }
      // Short non-values (mask dots, stray punctuation) are stepped over;
      // long implausible blobs abort the scan (don't reach past prose).
      if (!isPlausibleValueDom(candText)) {
        if (candText.length <= 20) continue;
        return null;
      }
      // Unlinked bare text is only taken when the label ends with a colon
      // (strong pairing signal), or when stepping over navigational chrome
      // only to reach it — never across another bare label (that is a
      // different, valueless field, not our value). Form values need no colon.
      // Cross-scope rescue: custom password components render the shown value
      // as plain text in a sibling container next to a •/*** mask run. Take
      // the first plausible value ONLY with that dots adjacency (behind or
      // ahead within 3) — greetings/prose have no mask run and stay untouched.
      if (!colonTerminated && (skippedNav === 0 || skippedLabel > 0)) {
        if (!(crossedScope && (seenDots || dotsAhead(segments, j)))) return null;
      }
      return { seg: cand, index: j };
    }
    return null;
  }
  return null;
}

/**
 * Mask-run peek for the cross-scope rescue: is there a •/*** run within 3
 * segments ahead of index (the custom-component password signature)?
 */
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
  // Two real table shapes (see resolveStructuralHint):
  //  D1 columnar — td segments carry tableHeader naming their COLUMN. When
  //      the header itself is secret vocabulary, every value under it is.
  //  D2 row-style — <tr><th>Key</th><td>value</td></tr> carries no header
  //      hint, so group by shared <tr> domPath prefix instead and pair the
  //      th key with its adjacent td value (image vertical-geometry analog).
  const forced = new Set();
  const forceTypeAt = new Map();
  const force = (index, type, label) => {
    const seg = segments[index];
    if (!seg || seg.forceRedact || forced.has(index)) return;
    if (!isPlausibleValueDom(String(seg.text ?? ""))) return;
    forced.add(index);
    forceTypeAt.set(index, { type, label });
  };

  segments.forEach((seg, index) => {
    if (!seg || typeof seg !== "object" || seg.forceRedact) return;
    // D1: secret column header.
    const header =
      seg.structuralHint && typeof seg.structuralHint.tableHeader === "string"
        ? seg.structuralHint.tableHeader
        : "";
    if (header) {
      const hit = findSecretLabelMatch(header);
      // The header cell itself ("Password") is a bare label, not a value —
      // only force segments whose own text is a plausible value.
      if (hit && seg.tag !== "th" && String(seg.text ?? "").trim() !== header.trim()) {
        force(index, hit.type, hit.label);
        return;
      }
    }
    // D2: th key in the same table row (domPath shares the tr prefix).
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
