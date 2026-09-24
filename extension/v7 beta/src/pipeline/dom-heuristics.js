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
 * piidetector.js REPLACEMENTS — no new format is invented.
 */
export function placeholderForForceRedact(element, reason) {
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
