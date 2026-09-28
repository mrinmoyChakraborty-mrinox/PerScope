/**
 * PerScope DOM Capture — Segment Walker (content-script context, browser-only)
 *
 * Snapshot mode: extract DOM text/values/attributes into ordered segments,
 * run Koyel's Tier0 (`detectPII`/`redactPII` from piidetector.js, unmodified,
 * injected as `detector`) PER SEGMENT, and hand off clean text. The DOM is
 * never mutated — no live-page blurring, no overlay, no writes.
 *
 * Why per-segment detection (not one joined string): the DOM equivalent of the
 * image pipeline's `resolveSensitiveValueBBox` chokepoint is segmentation —
 * mapping "PII found in text" back to "which node/attribute/field it came
 * from", so findings carry `{ segmentId, structuralHint, source: "dom" }`
 * instead of one anonymous blob. The explicit `source: "dom"` tag is what
 * lets Tier0 trust DOM checksum hits differently from OCR hits.
 *
 * Privacy: raw segment text and `domPath` live in local scope only and are
 * discarded after redaction. They never appear in `findings` or logs
 * ("redact before logging").
 */

import {
  associateLabelValues,
  classifySensitiveField,
  placeholderForForceRedact,
  resolveStructuralHint,
  getBlockRole,
  reconstructDocument,
  extractSpokenEmailSpans,
} from "./dom-heuristics.js";

export const IGNORED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
]);

export const ATTRIBUTE_SEGMENT_NAMES = ["aria-label", "alt", "title", "placeholder"];

export const FORM_VALUE_TAGS = new Set(["input", "textarea", "select"]);

const FALLBACK_FILTER = { ACCEPT: 1, REJECT: 2, SKIP: 3, SHOW_TEXT: 4, SHOW_ELEMENT: 1 };

function resolveNodeFilter(options, rootDoc) {
  const NF =
    (options && options.NodeFilter) ||
    (typeof NodeFilter !== "undefined" ? NodeFilter : null) ||
    (rootDoc && rootDoc.defaultView && rootDoc.defaultView.NodeFilter) ||
    null;
  if (NF && NF.FILTER_ACCEPT !== undefined) {
    return {
      FILTER_ACCEPT: NF.FILTER_ACCEPT,
      FILTER_REJECT: NF.FILTER_REJECT,
      FILTER_SKIP: NF.FILTER_SKIP,
      SHOW_TEXT: NF.SHOW_TEXT !== undefined ? NF.SHOW_TEXT : 4,
      SHOW_ELEMENT: NF.SHOW_ELEMENT !== undefined ? NF.SHOW_ELEMENT : 1,
    };
  }
  return {
    FILTER_ACCEPT: FALLBACK_FILTER.ACCEPT,
    FILTER_REJECT: FALLBACK_FILTER.REJECT,
    FILTER_SKIP: FALLBACK_FILTER.SKIP,
    SHOW_TEXT: FALLBACK_FILTER.SHOW_TEXT,
    SHOW_ELEMENT: FALLBACK_FILTER.SHOW_ELEMENT,
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

/**
 * Stable structural locator for debugging only. NEVER sent upstream in
 * evidence and never included in findings (privacy note in the spec).
 */
export function buildDomPath(node) {
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
        return Array.from(selected)
          .map((o) => (o.textContent !== undefined ? o.textContent : o.value))
          .join(", ");
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

/**
 * Walk one document (or shadow root) with a real TreeWalker filter callback.
 * Ignored subtrees return FILTER_REJECT so they are never descended into —
 * no post-walk filtering. Form values and attribute segments are collected
 * during the same pass, so rejected subtrees contribute nothing of any kind.
 */
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
    },
  };

  let walker;
  try {
    walker = rootDoc.createTreeWalker(rootNode, whatToShow, filter);
  } catch {
    return;
  }

  const visitElement = (el) => {
    const tag = String(el.tagName || "").toLowerCase();

    // Open shadow DOM: recurse; closed roots are counted, never silently dropped.
    try {
      const shadow = el.shadowRoot;
      if (shadow) {
        if (shadow.mode === "open") {
          walkRoot(shadow, rootDoc, NF, state);
        } else {
          state.skipped.shadowRootsClosed += 1;
        }
      } else if (typeof el.attachShadow === "undefined" && el.shadowRoot === undefined) {
        void 0;
      }
    } catch {
      state.skipped.shadowRootsClosed += 1;
    }

    // Same-origin iframe: recurse via contentDocument. Cross-origin access
    // throws from this context — record the element so the entry point can
    // collect it via the all_frames postMessage channel; if no collector
    // claims it, it counts as unreachable (never silently omitted).
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

    // Form field values (not text nodes).
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
            ...(hint ? { structuralHint: hint } : {}),
            domPath: buildDomPath(el),
          });
        }
      }
    }

    // Attribute segments: an element may contribute its text node AND its
    // aria-label — never dedupe across kinds, only exact triples.
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
            ...(hint ? { structuralHint: hint } : {}),
            domPath: buildDomPath(el),
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
          const hint = host ? resolveStructuralHint(host) : undefined;
          state.segments.push({
            id: nextSegmentId(state),
            kind: "text",
            tag: host ? String(host.tagName || "span").toLowerCase() : "span",
            text: String(node.nodeValue ?? ""),
            blockRole: getBlockRole(host),
            forceRedact: false,
            ...(hint ? { structuralHint: hint } : {}),
            domPath: buildDomPath(node),
          });
        }
      } else if (node.nodeType === 1) {
        visitElement(node);
      }
      node = walker.nextNode();
    }
  } catch {
    // A hostile/adversarial page must not break capture; keep what we have.
  }
}

/**
 * Capture ordered segments from a document.
 *
 * @param {Document} rootDoc document to capture (defaults to global document)
 * @param {object} [options] { NodeFilter, collectCrossOriginFrames }
 * @returns {{ segments: Array, skipped: { shadowRootsClosed: number, iframesCrossOriginUnreachable: number }, frameCount: number, crossOriginFrames: Array }}
 */
export function captureDOMSegments(rootDoc, options) {
  const doc =
    rootDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) {
    return {
      segments: [],
      skipped: { shadowRootsClosed: 0, iframesCrossOriginUnreachable: 0 },
      frameCount: 0,
      crossOriginFrames: [],
    };
  }
  const NF = resolveNodeFilter(options || {}, doc);
  const state = {
    segments: [],
    seen: new Set(),
    counter: 0,
    frameCount: 1,
    crossOriginFrames: [],
    skipped: { shadowRootsClosed: 0, iframesCrossOriginUnreachable: 0 },
  };
  const root = doc.body || doc.documentElement || doc;
  walkRoot(root, doc, NF, state);
  // Frames unreachable from this context count here unless the entry-point
  // collector (all_frames postMessage channel) claims them later.
  state.skipped.iframesCrossOriginUnreachable = state.crossOriginFrames.length;
  return {
    segments: state.segments,
    skipped: state.skipped,
    frameCount: state.frameCount,
    crossOriginFrames:
      options && options.collectCrossOriginFrames === false ? [] : state.crossOriginFrames,
  };
}

/**
 * Run Tier0 per segment. Forced (password/hidden) segments skip detectPII
 * entirely and go straight to a REPLACEMENTS-convention placeholder.
 * Structural context is merged as a SIBLING field (`structuralHint`) —
 * `confidence` from detectPII is passed through untouched.
 *
 * Findings never contain raw values, offsets, or domPath.
 */
export function runTier0OnSegments(segments, detector) {
  if (!detector || typeof detector.detectPII !== "function" || typeof detector.redactPII !== "function") {
    throw new Error("runTier0OnSegments requires { detectPII, redactPII } from piidetector.js");
  }
  const segmentResults = [];
  const findings = [];

  for (const segment of segments || []) {
    const structuralHint = segment.structuralHint ? { ...segment.structuralHint } : undefined;

    if (segment.forceRedact) {
      const placeholder = placeholderForForceRedact(
        null,
        segment.forceReason || "input-type-password",
        segment.forcedType
      );
      const type =
        segment.forcedType ||
        (placeholder === "<CARD_NUMBER>" ? "CARD_NUMBER" : "PASSWORD");
      segmentResults.push({ segment, redactedText: placeholder, detections: [] });
      findings.push({
        type,
        source: "dom",
        confidence: 1.0,
        ...(structuralHint ? { structuralHint } : {}),
        segmentId: segment.id,
        forceRedacted: true,
      });
      continue;
    }

    const text = String(segment.text ?? "");
    if (!text.trim()) {
      segmentResults.push({ segment, redactedText: text, detections: [] });
      continue;
    }
    const detection = detector.detectPII(text);
    const detections = [...((detection && detection.detections) || [])];
    // Spoken-email spans (extension-side, piidetector contract untouched):
    // merge spans that don't overlap a piidetector hit, then redact jointly
    // so offsets stay consistent (redactPII sorts right-to-left).
    for (const span of extractSpokenEmailSpans(text)) {
      const collides = detections.some((d) => span.start < d.end && span.end > d.start);
      if (!collides) detections.push(span);
    }
    const redactedText = detector.redactPII(detection ? detection.text : text, detections);
    segmentResults.push({ segment, redactedText, detections });
    for (const d of detections) {
      findings.push({
        type: d.type,
        source: "dom",
        confidence: d.confidence,
        ...(structuralHint ? { structuralHint } : {}),
        segmentId: segment.id,
        forceRedacted: false,
      });
    }
  }

  return { segmentResults, findings };
}

/**
 * Full snapshot pipeline: walk -> label/value association -> Tier0 per
 * segment -> block-aware rebuild. Never mutates the DOM. Empty findings is
 * a valid, non-error result.
 *
 * Association runs BEFORE Tier0 (mirroring Tier0-before-NER layering):
 * label-associated secrets skip pattern matching entirely, because random
 * strings carry no pattern signature to match.
 */
export function captureDOM(rootDoc, detector, options) {
  const { segments, skipped, frameCount } = captureDOMSegments(rootDoc, options);
  const associated = associateLabelValues(segments);
  const { segmentResults, findings } = runTier0OnSegments(associated, detector);
  const redactedDocument = reconstructDocument(
    segmentResults.map((r) => ({ blockRole: r.segment.blockRole, redactedText: r.redactedText }))
  );
  // Raw text and domPath stay in local scope; explicitly drop references.
  for (const r of segmentResults) {
    r.segment.text = "";
    r.segment.domPath = "";
  }
  return {
    capturedAt: Date.now(),
    frameCount,
    segmentCount: segments.length,
    redactedDocument,
    findings,
    skipped: { ...skipped },
  };
}
