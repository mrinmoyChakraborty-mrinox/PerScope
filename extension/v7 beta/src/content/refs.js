/**
 * PerScope content-layer element registry (browser + fixture compatible).
 *
 * Format C (locked): content assigns opaque refs at enumeration time and
 * holds {ref -> live Element} per page load. Every action call re-resolves
 * against the live DOM; `stale_element` is returned only on a genuine
 * mismatch (node gone, tag changed, recorded id/name changed) — never
 * merely because a re-list happened. Re-lists are deterministic: unchanged
 * elements keep their refs, only genuinely new elements mint new refs.
 *
 * Pure DOM (no chrome APIs) so the identical code is unit-testable in Node
 * against the fixture DOM. T6d's click/type/submit will call resolveRef —
 * this module is the exact function under test, not a stand-in.
 */

import { buildDomPath } from "../pipeline/dom-capture.js";

const registry = new Map(); // ref -> { domPath, tag, label, idAttr, nameAttr }
let counter = 0;

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select"]);

function isSkippable(el) {
  if (!el || typeof el.tagName !== "string") return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") return true;
  if (tag === "input") {
    const type = String(el.getAttribute ? el.getAttribute("type") : el.type || "text")
      .trim()
      .toLowerCase();
    if (type === "hidden") return true;
  }
  if (el.hidden) return true;
  try {
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
  } catch {
    // Best effort.
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
    // Best effort.
  }
  return false;
}

function textOf(el, maxLen = 60) {
  try {
    const t = String(el.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  } catch {
    return "";
  }
}

/** Human label: aria-label, associated <label>, text, value/placeholder, name. */
export function elementLabel(el) {
  try {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && String(aria).trim()) return String(aria).trim().slice(0, 60);
  } catch {
    // Best effort.
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
    // Best effort.
  }
  const text = textOf(el);
  if (text) return text;
  try {
    for (const attr of ["value", "placeholder", "name", "title"]) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && String(v).trim()) return String(v).trim().slice(0, 60);
    }
  } catch {
    // Best effort.
  }
  return "";
}

export function elementRole(el) {
  const tag = String(el.tagName || "").toLowerCase();
  try {
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "button" || role === "link") return role;
  } catch {
    // Best effort.
  }
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = String(el.getAttribute ? el.getAttribute("type") : el.type || "text")
      .trim()
      .toLowerCase();
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
    // Best effort.
  }
  return {
    idAttr: idAttr != null ? String(idAttr) : null,
    nameAttr: nameAttr != null ? String(nameAttr) : null,
  };
}

function collectInteractive(root) {
  const found = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      if (isInteractive(node)) found.push(node);
      // Do not descend into script/style subtrees (mirrors capture walk).
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

/**
 * Enumerate clickable/typeable elements. Deterministic: unchanged elements
 * keep their refs across calls; only genuinely new elements mint refs.
 * Read-only: never mutates the DOM. Returns [{ref, tag, label, role}]
 * with NO locator internals (domPath stays registry-side only).
 */
export function enumerateInteractive(rootDoc) {
  const seenPaths = new Set();
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

/**
 * Re-resolve a ref against the live DOM (call on EVERY action).
 * Returns { element } or { stale: true, reason } — stale ONLY on genuine
 * mismatch (node gone / tag changed / recorded id+name changed), never on
 * re-list, text edits, or attribute drift elsewhere.
 */
export function resolveRef(rootDoc, ref) {
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

/** Walk an index-based domPath (`html[0]/body[1]/div[2]`) from the document. */
export function walkDomPath(rootDoc, domPath) {
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
    // buildDomPath sibling indices are 1-based (first match === [1]).
    const siblings = childElements(node).filter(
      (c) => String(c.tagName || "").toLowerCase() === tag.toLowerCase()
    );
    node = siblings[Number(indexStr) - 1] ?? null;
    if (!node) return null;
  }
  return node;
}

/** Test seam: clear the per-page registry. */
export function resetRegistry() {
  registry.clear();
  counter = 0;
}
