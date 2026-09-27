/**
 * PerScope content-layer action executors (T6d).
 *
 * Pure DOM + refs.js registry: no chrome APIs, so the identical code is
 * unit-testable in Node against the fixture DOM (same contract as refs.js
 * / dom-capture.test.mjs). The entry listener (dom-capture-entry.js) is the
 * only chrome boundary.
 *
 * Two-phase protocol (locator internals never leave the page):
 *   PREVIEW_ACTION {tool, ref} -> {ok, signals:{tool,ref,tag,label,text,
 *     inputType,isFormSubmit}} — what WOULD happen, for isDestructive().
 *   EXECUTE_ACTION {tool, ref?, text?, value?, direction?, amount?}
 *     -> {ok, ref?} | {ok:false, reason}.
 *
 * Reasons (honest, verbatim-safe): unknown-ref | stale_element |
 * unsupported-tool | not-typeable | invalid-option | no-form |
 * bad-arguments.
 */

import { resolveRef, elementLabel } from "./refs.js";

const REF_TOOLS = new Set(["click", "type", "select_option", "submit"]);

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
        (el.getAttribute && el.getAttribute("type")) || el.type || "text"
      )
        .trim()
        .toLowerCase();
    }
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
  } catch {
    // Best effort.
  }
  return "";
}

/** True when activating this element submits a form (click or submit tool). */
function isSubmitControl(el) {
  try {
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input") {
      const t = inputTypeOf(el);
      return t === "submit" || t === "image";
    }
    if (tag === "button") {
      const t = String((el.getAttribute && el.getAttribute("type")) || "").trim().toLowerCase();
      // A <button> with no type inside a form defaults to submit.
      if (!t) return !!owningForm(el);
      return t === "submit";
    }
  } catch {
    // Best effort.
  }
  return false;
}

/** Nearest ancestor <form>, or the element itself when it is one. */
function owningForm(el) {
  try {
    if (el && typeof el.form !== "undefined" && el.form) return el.form;
    let node = el ? el.parentNode : null;
    while (node) {
      if (node.nodeType === 1 && String(node.tagName || "").toLowerCase() === "form") return node;
      node = node.parentNode;
    }
  } catch {
    // Best effort.
  }
  return null;
}

/** Framework-compatible value set: native setter + input/change events. */
function setFieldValue(el, value) {
  const text = String(value ?? "");
  try {
    const proto =
      String(el.tagName || "").toLowerCase() === "textarea"
        ? Object.getPrototypeOf(el) || null
        : null;
    const setter =
      (proto && Object.getOwnPropertyDescriptor(proto, "value")?.set) ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, "value")?.set;
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
        const Ctor =
          (typeof window !== "undefined" && window.Event) ||
          (typeof Event !== "undefined" ? Event : null);
        if (Ctor) el.dispatchEvent(new Ctor(type, { bubbles: true }));
      }
    } catch {
      // Events are best-effort (fixture DOM has no Event).
    }
  }
  return true;
}

/**
 * Describe what an action WOULD do. Never mutates the DOM.
 * @returns {{ok:true, signals:object} | {ok:false, reason:string}}
 */
export function previewAction(rootDoc, { tool, ref } = {}) {
  if (tool === "scroll") {
    return { ok: true, signals: { tool, ref: null, tag: "", label: "", text: "", inputType: "", isFormSubmit: false } };
  }
  if (!REF_TOOLS.has(tool)) return { ok: false, reason: "unsupported-tool" };
  if (typeof ref !== "string" || !ref) return { ok: false, reason: "unknown-ref" };
  const resolved = resolveRef(rootDoc, ref);
  if (!resolved || !resolved.element) {
    return { ok: false, reason: (resolved && resolved.reason) || "stale_element" };
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
      isFormSubmit: tool === "submit" || isSubmitControl(el),
    },
  };
}

/**
 * Execute an action against the live DOM. Resolves the ref fresh on every
 * call (same guarantee as preview: stale only on genuine mismatch).
 * @returns {{ok:true, ref?:string} | {ok:false, reason:string}}
 */
export function executeAction(rootDoc, win, { tool, ref, text, value, direction, amount } = {}) {
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
    return { ok: false, reason: (resolved && resolved.reason) || "stale_element" };
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
      const typeable =
        tag === "textarea" ||
        (tag === "input" &&
          ["text", "search", "email", "tel", "url", "password", "number"].includes(kind));
      if (!typeable) return { ok: false, reason: "not-typeable" };
      try {
        if (typeof el.focus === "function") el.focus();
      } catch {}
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
