/**
 * DOM capture tests (node:test, zero new dependencies).
 *
 * Uses a minimal in-file fixture DOM ("equivalent" fixture page — no JSDOM
 * install required) implementing exactly the surface dom-capture.js needs:
 * createTreeWalker with FILTER_REJECT subtree semantics, shadow roots,
 * same-origin vs throwing cross-origin iframe contentDocument, labels,
 * aria attributes, and table headers. Tier0 is Koyel's REAL piidetector.js
 * (detectPII/redactPII), loaded unmodified via createRequire.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  captureDOMSegments,
  runTier0OnSegments,
  captureDOM,
} from "../src/pipeline/dom-capture.js";
import {
  associateLabelValues,
  classifySensitiveField,
  findSecretLabelMatch,
  isPlausibleValueDom,
  mapAutocompleteToType,
  resolveStructuralHint,
  reconstructDocument,
} from "../src/pipeline/dom-heuristics.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line no-unused-vars
const pii = require("../../../piidetector.js");
const detector = { detectPII: pii.detectPII, redactPII: pii.redactPII };

const NF = {
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_TEXT: 4,
  SHOW_ELEMENT: 1,
};

/* ---------------- Minimal fixture DOM ---------------- */

function txt(data) {
  return {
    nodeType: 3,
    nodeValue: data,
    parentNode: null,
    parentElement: null,
    ownerDocument: null,
  };
}

function el(tag, attrs = {}, children = []) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attributes: { ...attrs },
    childNodes: [],
    parentNode: null,
    parentElement: null,
    ownerDocument: null,
    shadowRoot: undefined,
    hidden: false,
    value: attrs.value !== undefined ? attrs.value : undefined,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    },
    get textContent() {
      let out = "";
      for (const c of this.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) out += c.textContent;
      }
      return out;
    },
    closest(sel) {
      const want = String(sel).toLowerCase();
      let p = this.parentNode;
      while (p) {
        if (p.nodeType === 1 && String(p.tagName).toLowerCase() === want) return p;
        p = p.parentNode;
      }
      return null;
    },
    querySelectorAll(sel) {
      return queryAll(this, sel);
    },
    querySelector(sel) {
      return queryAll(this, sel)[0] || null;
    },
  };
  for (const child of children) appendChild(node, child);
  return node;
}

function appendChild(parent, child) {
  if (typeof child === "string") child = txt(child);
  child.parentNode = parent;
  child.parentElement = parent.nodeType === 1 ? parent : parent.parentElement || null;
  parent.childNodes.push(child);
  return child;
}

function descendants(root, out = []) {
  for (const c of root.childNodes || []) {
    out.push(c);
    if (c.nodeType === 1) descendants(c, out);
  }
  return out;
}

function matchesSimple(node, sel) {
  if (node.nodeType !== 1) return false;
  const tag = String(node.tagName).toLowerCase();
  let s = sel.trim();
  if (s.startsWith("#")) return node.getAttribute("id") === s.slice(1);
  const pseudoChecked = s.endsWith(":checked");
  if (pseudoChecked) s = s.slice(0, -":checked".length);
  const attrMatch = s.match(/^([a-z0-9]*)?\[for="([^"]+)"\]$/i);
  if (attrMatch) {
    if (attrMatch[1] && attrMatch[1].toLowerCase() !== tag) return false;
    return node.getAttribute("for") === attrMatch[2];
  }
  if (s.includes(":first-child")) {
    const [parentSel, childSel] = s.split(":first-child").map((x) => x.trim());
    if (childSel && childSel.toLowerCase() !== tag) return false;
    const parent = node.parentNode;
    if (!parent || String(parent.tagName || "").toLowerCase() !== parentSel.toLowerCase()) return false;
    const firstEl = (parent.childNodes || []).find((c) => c.nodeType === 1);
    return firstEl === node;
  }
  if (pseudoChecked) {
    if (s && s.toLowerCase() !== tag) return false;
    return node.getAttribute("selected") !== null || node.selected === true;
  }
  return s.toLowerCase() === tag;
}

function matchesChain(node, parts) {
  let current = node;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!current || !matchesSimple(current, parts[i])) return false;
    if (i > 0) {
      let p = current.parentNode;
      let found = false;
      while (p) {
        if (p.nodeType === 1 && matchesSimple(p, parts[i - 1])) {
          found = true;
          current = p;
          break;
        }
        p = p.parentNode;
      }
      if (!found) return false;
      i -= 1;
    }
  }
  return true;
}

function queryAll(root, selector) {
  const out = [];
  const groups = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  const pool = root.nodeType === 9 ? descendants(root) : [root, ...descendants(root)];
  for (const group of groups) {
    const parts = group.split(/\s+/);
    for (const node of pool) {
      if (matchesChain(node, parts) && !out.includes(node)) out.push(node);
    }
  }
  return out;
}

// TreeWalker honoring FILTER_REJECT subtree semantics (the point of the walk:
// rejected subtrees are never descended into).
function fakeCreateTreeWalker(root, whatToShow, filter) {
  const ordered = [];
  function visit(node) {
    const show = node.nodeType === 1 ? NF.SHOW_ELEMENT : node.nodeType === 3 ? NF.SHOW_TEXT : 0;
    if (show && whatToShow & show) {
      const verdict = filter.acceptNode(node);
      if (verdict === NF.FILTER_REJECT) return;
      if (verdict === NF.FILTER_ACCEPT) ordered.push(node);
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(root);
  let index = 0;
  return {
    nextNode() {
      if (index >= ordered.length) return null;
      const node = ordered[index];
      index += 1;
      return node;
    },
  };
}

function makeDocument(body) {
  const doc = {
    nodeType: 9,
    childNodes: [],
    parentNode: null,
    ownerDocument: null,
    defaultView: { NodeFilter: NF },
    createTreeWalker: fakeCreateTreeWalker,
    querySelectorAll(sel) {
      return queryAll(this, sel);
    },
    querySelector(sel) {
      return queryAll(this, sel)[0] || null;
    },
    getElementById(id) {
      return queryAll(this, `#${id}`)[0] || null;
    },
  };
  const html = el("html", {}, []);
  const docBody = body || el("body", {}, []);
  appendChild(html, docBody);
  appendChild(doc, html);
  doc.body = docBody;
  doc.documentElement = html;
  const assign = (node) => {
    node.ownerDocument = doc;
    for (const c of node.childNodes || []) assign(c);
  };
  assign(doc);
  doc.ownerDocument = doc;
  return doc;
}

function makeShadowRoot(host, mode, children = []) {
  const root = {
    nodeType: 11,
    mode,
    childNodes: [],
    parentNode: host,
    host,
    ownerDocument: host.ownerDocument,
  };
  for (const child of children) appendChild(root, child);
  const assign = (node) => {
    node.ownerDocument = host.ownerDocument;
    for (const c of node.childNodes || []) assign(c);
  };
  assign(root);
  host.shadowRoot = root;
  return root;
}

/** Build the acceptance fixture page. */
function buildFixturePage() {
  const emailLabel = el("label", { for: "email" }, ["Email address"]);
  const emailInput = el("input", {
    id: "email",
    name: "email",
    type: "text",
    autocomplete: "email",
    value: "jane@example.com",
  });
  const passwordInput = el("input", { id: "pw", name: "pw", type: "password", value: "s3cr3t!" });
  const hiddenInput = el("input", { id: "tok", type: "hidden", value: "token123" });
  const ariaDiv = el("div", { "aria-label": "Call 9876543210 today" }, ["Support line"]);

  const para = el("p", {}, ["Contact john.doe@example.com for details"]);
  const heading = el("h1", {}, ["Account overview"]);

  const th = el("th", {}, ["Phone"]);
  const td = el("td", {}, ["Call 9123456780 now"]);
  const headRow = el("tr", {}, [th]);
  const thead = el("thead", {}, [headRow]);
  const bodyRow = el("tr", {}, [td]);
  const tbody = el("tbody", {}, [bodyRow]);
  const table = el("table", {}, [thead, tbody]);

  // Open shadow root with PII text.
  const shadowHost = el("div", { id: "shadow-host" }, []);
  // Closed shadow root (counted, never entered).
  const closedHost = el("div", { id: "closed-host" }, []);

  // Same-origin iframe with its own document.
  const iframeDoc = makeDocument(el("body", {}, [el("p", {}, ["iframe contact 9988776655"])]));
  const sameOriginFrame = el("iframe", { id: "same-frame" }, []);
  Object.defineProperty(sameOriginFrame, "contentDocument", { value: iframeDoc });

  // Synthetic cross-origin iframe: access throws from this context.
  const crossOriginFrame = el("iframe", { id: "x-frame" }, []);
  Object.defineProperty(crossOriginFrame, "contentDocument", {
    get() {
      throw new Error("Blocked a frame with origin");
    },
  });

  // Hidden subtree: must never be descended into (walker-level REJECT).
  const hiddenPara = el("p", {}, ["hidden-secret@example.com"]);
  const hiddenDiv = el("div", { hidden: "" }, [hiddenPara]);
  const scriptEl = el("script", {}, ["var x = 'script-secret@example.com';"]);

  const body = el(
    "body",
    {},
    [
      heading,
      para,
      emailLabel,
      emailInput,
      passwordInput,
      hiddenInput,
      ariaDiv,
      table,
      shadowHost,
      closedHost,
      sameOriginFrame,
      crossOriginFrame,
      hiddenDiv,
      scriptEl,
    ]
  );
  const doc = makeDocument(body);
  makeShadowRoot(shadowHost, "open", [el("span", {}, ["shadow user shadowbox@example.org"])]);
  makeShadowRoot(closedHost, "closed", [el("span", {}, ["closed-secret@example.com"])]);
  return { doc, refs: { td } };
}

/* ---------------- Tests ---------------- */

test("acceptance: email text + labelled email input + password + aria-label phone all produce findings with source dom", () => {
  const { doc } = buildFixturePage();
  const result = captureDOM(doc, detector, { NodeFilter: NF });

  const types = result.findings.map((f) => f.type);
  assert.ok(types.includes("EMAIL_ID"), `expected EMAIL_ID findings, got ${types}`);
  assert.ok(types.includes("PHONE_NUMBER"), `expected PHONE_NUMBER findings, got ${types}`);

  for (const f of result.findings) assert.equal(f.source, "dom");

  const forced = result.findings.filter((f) => f.forceRedacted);
  assert.ok(forced.length >= 2, "expected password + hidden force-redacted findings");
  // type=password / type=hidden inputs stay PASSWORD-typed and forced...
  const pwForced = forced.filter((f) => f.type === "PASSWORD");
  assert.ok(pwForced.length >= 2, `expected >=2 forced PASSWORD, got ${JSON.stringify(forced.map((f) => f.type))}`);
  // ...while label-associated values carry their precise associated type
  // (association runs before Tier0): the labelled email input is forced
  // EMAIL_ID with its label hint intact, not generic PASSWORD.
  const emailForced = forced.filter(
    (f) => f.type === "EMAIL_ID" && f.structuralHint && f.structuralHint.labelText === "Email address"
  );
  assert.ok(emailForced.length >= 1, "expected forced EMAIL_ID with labelText hint");
  assert.ok(
    forced.every((f) => ["PASSWORD", "EMAIL_ID", "PHONE_NUMBER", "OTP", "PIN", "UPI_VPA", "BANK_ACCOUNT", "CARD_NUMBER", "IFSC_CODE", "DATE_OF_BIRTH", "AADHAAR", "PASSPORT_NUMBER"].includes(f.type)),
    `forced finding with unexpected type: ${JSON.stringify(forced.map((f) => f.type))}`
  );

  // Raw secrets must never reach findings or serialized output.
  const serialized = JSON.stringify(result.findings) + result.redactedDocument;
  assert.ok(!serialized.includes("s3cr3t!"), "password value leaked");
  assert.ok(!serialized.includes("token123"), "hidden value leaked");
  assert.ok(!serialized.includes("domPath"), "domPath leaked");
});

test("label association: email input finding carries structuralHint.labelText", () => {
  const { doc } = buildFixturePage();
  const result = captureDOM(doc, detector, { NodeFilter: NF });
  const labelled = result.findings.filter(
    (f) => f.type === "EMAIL_ID" && f.structuralHint && f.structuralHint.labelText === "Email address"
  );
  assert.ok(labelled.length >= 1, "expected EMAIL_ID finding with labelText hint");
});

test("table header association: td text finding carries tableHeader", () => {
  const { doc } = buildFixturePage();
  const result = captureDOM(doc, detector, { NodeFilter: NF });
  const cell = result.findings.filter(
    (f) => f.structuralHint && f.structuralHint.tableHeader === "Phone"
  );
  assert.ok(cell.length >= 1, "expected finding with tableHeader hint");
});

test("shadow DOM: open root traversed, closed root counted", () => {
  const { doc } = buildFixturePage();
  const result = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(
    result.redactedDocument.includes("<EMAIL_ID>") || result.findings.some((f) => f.type === "EMAIL_ID"),
    "expected open shadow content captured"
  );
  assert.equal(result.skipped.shadowRootsClosed, 1);
  const serialized = JSON.stringify(result.findings) + result.redactedDocument;
  assert.ok(!serialized.includes("closed-secret"), "closed shadow content must not be captured");
});

test("iframes: same-origin content included, cross-origin counted not silently omitted", () => {
  const { doc } = buildFixturePage();
  const result = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(
    result.redactedDocument.includes("<PHONE_NUMBER>"),
    "expected same-origin iframe phone in redactedDocument"
  );
  assert.equal(result.skipped.iframesCrossOriginUnreachable, 1);
});

test("walker-level rejection: hidden/script subtrees never contribute segments", () => {
  const { doc } = buildFixturePage();
  const { segments } = captureDOMSegments(doc, { NodeFilter: NF });
  const texts = segments.map((s) => s.text).join("\n");
  assert.ok(!texts.includes("hidden-secret"), "hidden subtree leaked into segments");
  assert.ok(!texts.includes("script-secret"), "script subtree leaked into segments");
  assert.ok(texts.includes("john.doe@example.com"), "visible text missing");
});

test("determinism: two captures of a static page produce identical findings", () => {
  const first = captureDOM(buildFixturePage().doc, detector, { NodeFilter: NF });
  const second = captureDOM(buildFixturePage().doc, detector, { NodeFilter: NF });
  assert.deepEqual(second.findings, first.findings);
  assert.equal(second.redactedDocument, first.redactedDocument);
});

test("classifySensitiveField: password/hidden/secret-autocomplete bypass, plain fields do not", () => {
  assert.equal(classifySensitiveField(el("input", { type: "password" }, [])).forceRedact, true);
  assert.equal(classifySensitiveField(el("input", { type: "hidden" }, [])).forceRedact, true);
  assert.equal(
    classifySensitiveField(el("input", { type: "text", autocomplete: "cc-number" }, [])).forceRedact,
    true
  );
  assert.equal(classifySensitiveField(el("input", { type: "text" }, [])).forceRedact, false);
  assert.equal(classifySensitiveField(el("textarea", {}, [])).forceRedact, false);
});

test("mapAutocompleteToType: supplementary hint mapping only", () => {
  assert.equal(mapAutocompleteToType("email"), "EMAIL_ID");
  assert.equal(mapAutocompleteToType("tel"), "PHONE_NUMBER");
  assert.equal(mapAutocompleteToType("cc-number"), "CARD_NUMBER");
  assert.equal(mapAutocompleteToType("bday"), "DATE_OF_BIRTH");
  assert.equal(mapAutocompleteToType("off-topic-value"), undefined);
});

test("reconstructDocument: block boundaries preserved, not a single joined string", () => {
  const out = reconstructDocument([
    { blockRole: "heading", redactedText: "Account overview" },
    { blockRole: "paragraph", redactedText: "Contact <EMAIL_ID> for details" },
    { blockRole: "list_item", redactedText: "first item" },
    { blockRole: "list_item", redactedText: "second item" },
    { blockRole: "inline", redactedText: "trailing note" },
  ]);
  assert.ok(out.includes("Account overview\n\nContact"), `heading/paragraph break missing:\n${out}`);
  assert.ok(out.includes("first item\nsecond item"), `list breaks wrong:\n${out}`);
});

test("confidence passthrough: finding confidence equals Tier0 detectPII confidence", () => {
  const { doc } = buildFixturePage();
  const { segments } = captureDOMSegments(doc, { NodeFilter: NF });
  const target = segments.find((s) => s.text.includes("john.doe@example.com") && !s.forceRedact);
  assert.ok(target, "expected a text segment with the email");
  const direct = detector.detectPII(target.text).detections.find((d) => d.type === "EMAIL_ID");
  const { findings } = runTier0OnSegments([target], detector);
  const via = findings.find((f) => f.type === "EMAIL_ID");
  assert.ok(direct && via);
  assert.equal(via.confidence, direct.confidence);
});

test("association: visible password input with label hint is force-redacted (reported leak shape)", () => {
  const label = el("label", { for: "pw2" }, ["Password"]);
  const input = el("input", { id: "pw2", name: "pw2", type: "text", value: "mwafhaeiofhoeu" });
  const doc = makeDocument(el("body", {}, [el("div", {}, [label, input])]));
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes("mwafhaeiofhoeu"), "raw password value leaked to output");
  const hit = out.findings.find((f) => f.type === "PASSWORD" && f.forceRedacted);
  assert.ok(hit, "expected a force-redacted PASSWORD finding");
  assert.ok(out.redactedDocument.includes("<PASSWORD>"));
});

test("association: same-segment 'Label: value' split keeps the label", () => {
  const doc = makeDocument(el("body", {}, [el("p", {}, ["Password: hunter2secret"])]));
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(out.redactedDocument.includes("Password"), "label must stay visible");
  assert.ok(!out.redactedDocument.includes("hunter2secret"), "value must not survive");
  assert.ok(out.findings.some((f) => f.type === "PASSWORD" && f.forceRedacted));
});

test("association: colon-terminated bare label forces next same-block value", () => {
  const doc = makeDocument(
    el("body", {}, [el("div", {}, ["Password:"]), el("div", {}, ["s3cr3t-visible"])])
  );
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(!JSON.stringify(out).includes("s3cr3t-visible"));
  assert.ok(out.findings.some((f) => f.type === "PASSWORD" && f.forceRedacted));
});

test("association: row-style table th key forces adjacent td value", () => {
  const row = el("tr", {}, [el("th", {}, ["Password"]), el("td", {}, ["table-secret-9"])]);
  const doc = makeDocument(el("body", {}, [el("table", {}, [row])]));
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(!JSON.stringify(out).includes("table-secret-9"));
  assert.ok(out.findings.some((f) => f.type === "PASSWORD" && f.forceRedacted));
  assert.ok(out.redactedDocument.includes("Password"), "key cell stays visible");
});

test("association: secret column header forces values beneath it", () => {
  const thead = el("thead", {}, [el("tr", {}, [el("th", {}, ["Password"])])]);
  const tbody = el("tbody", {}, [el("tr", {}, [el("td", {}, ["col-secret-7"])])]);
  const doc = makeDocument(el("body", {}, [el("table", {}, [thead, tbody])]));
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  assert.ok(!JSON.stringify(out).includes("col-secret-7"));
  assert.ok(out.findings.some((f) => f.type === "PASSWORD" && f.forceRedacted));
});

test("association: value-only principle — labels are never force-marked", () => {
  const segs = [
    { id: "s1", kind: "text", tag: "span", text: "Password", blockRole: "inline" },
    { id: "s2", kind: "text", tag: "span", text: "Just some prose without secrets", blockRole: "inline" },
  ];
  const frozen = JSON.stringify(segs);
  const out = associateLabelValues(segs);
  assert.equal(JSON.stringify(segs), frozen, "input segments must not be mutated");
  assert.ok(out.find((s) => s.id === "s1" && !s.forceRedact), "bare label untouched");
  assert.ok(out.find((s) => s.id === "s2" && !s.forceRedact), "plain prose untouched");
});

test("association vocabulary: findSecretLabelMatch + plausible-value guards", () => {
  assert.deepEqual(findSecretLabelMatch("  Password: "), { label: "password", type: "PASSWORD" });
  assert.deepEqual(findSecretLabelMatch("UPI ID"), { label: "upi id", type: "UPI_VPA" });
  assert.equal(findSecretLabelMatch("Contact us anytime"), null);
  assert.equal(isPlausibleValueDom("mwafhaeiofhoeu"), true);
  assert.equal(isPlausibleValueDom("Thank you for reading this lengthy help article today"), false);
  assert.equal(isPlausibleValueDom(""), false);
});
test("association: link between label and value does not break pairing (reported login shape)", () => {
  const doc = makeDocument(
    el("body", {}, [
      el("div", {}, ["Password"]),
      el("a", { href: "/forgot" }, ["Forgot password?"]),
      el("div", {}, ["madiwhfaoniof"]),
      el("div", {}, ["\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"]),
      el("button", {}, ["Hide password"]),
    ])
  );
  const out = captureDOM(doc, detector, { NodeFilter: NF });
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes("madiwhfaoniof"), "raw password value leaked to output");
  assert.ok(out.findings.some((f) => f.type === "PASSWORD" && f.forceRedacted));
  assert.ok(out.redactedDocument.includes("<PASSWORD>"));
  assert.ok(out.redactedDocument.includes("Forgot password?"), "link text must stay visible");
  assert.ok(out.redactedDocument.includes("Hide password"), "toggle text must stay visible");
});
