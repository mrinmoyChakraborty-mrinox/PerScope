import assert from "node:assert/strict";
import test from "node:test";

import { enumerateInteractive, resetRegistry } from "../src/content/refs.js";
import { previewAction, executeAction } from "../src/content/actions.js";
import { isDestructive } from "../src/shared/is-destructive.js";

// Fixture DOM: same node contract as content-refs.test.mjs, plus action
// affordances (click/focus/value/dispatchEvent/form/requestSubmit).
function txt(data) {
  return { nodeType: 3, nodeValue: data, parentNode: null, parentElement: null, ownerDocument: null };
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
    hidden: false,
    value: "",
    clicked: 0,
    focused: 0,
    submitted: 0,
    events: [],
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    get textContent() {
      let out = "";
      for (const c of this.childNodes || []) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) out += c.textContent;
      }
      return out;
    },
    click() { this.clicked += 1; },
    focus() { this.focused += 1; },
    dispatchEvent(e) { this.events.push(e && e.type); return true; },
    requestSubmit() { this.submitted += 1; },
  };
  for (let child of children) {
    if (typeof child === "string") child = txt(child);
    child.parentNode = node;
    child.parentElement = node;
    node.childNodes.push(child);
  }
  return node;
}
function makeDocument(body) {
  const doc = { nodeType: 9, childNodes: [], parentNode: null, ownerDocument: null };
  const html = el("html", {}, []);
  const docBody = body || el("body", {}, []);
  docBody.parentNode = html;
  docBody.parentElement = html;
  html.childNodes.push(docBody);
  html.parentNode = doc;
  doc.childNodes.push(html);
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
function byId(doc, id) {
  const walk = (n) => {
    if (n.nodeType === 1 && n.getAttribute("id") === id) return n;
    for (const c of n.childNodes || []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(doc);
}
function refFor(doc, id) {
  const found = enumerateInteractive(doc).find((e) => {
    const n = byId(doc, id);
    return n && e.label.includes(n.getAttribute("aria-label") || id);
  });
  // Fallback: match by registry order-independent scan of enumerated refs.
  const all = enumerateInteractive(doc);
  assert.ok(all.length > 0, "page enumerates");
  return found ? found.ref : all[0].ref;
}

function page() {
  return makeDocument(
    el("body", {}, [
      el("form", { id: "login" }, [
        el("input", { id: "email", name: "email", type: "email", "aria-label": "Email" }),
        el("input", { id: "pw", name: "pw", type: "password", "aria-label": "Password" }),
        el("button", { id: "go", type: "submit", "aria-label": "Log in" }, ["Log in"]),
      ]),
      el("button", { id: "del", "aria-label": "Delete Account" }, ["Delete Account"]),
      el("select", { id: "pick", name: "pick", "aria-label": "Choice" }),
    ])
  );
}

test("preview describes signals; destructive button judges destructive", () => {
  resetRegistry();
  const doc = page();
  const all = enumerateInteractive(doc);
  const del = all.find((e) => e.label === "Delete Account");
  assert.ok(del, "delete button enumerated");
  const pv = previewAction(doc, { tool: "click", ref: del.ref });
  assert.equal(pv.ok, true);
  assert.equal(pv.signals.tag, "button");
  const verdict = isDestructive({ tool: "click", label: pv.signals.label, text: pv.signals.text });
  assert.equal(verdict.destructive, true, "delete-account click gates");
});

test("preview of email typing judges non-destructive", () => {
  resetRegistry();
  const doc = page();
  const all = enumerateInteractive(doc);
  const email = all.find((e) => e.label === "Email");
  assert.ok(email, "email field enumerated");
  const pv = previewAction(doc, { tool: "type", ref: email.ref });
  assert.equal(pv.ok, true);
  assert.equal(pv.signals.inputType, "email");
  const verdict = isDestructive({ tool: "type", label: pv.signals.label, inputType: pv.signals.inputType });
  assert.equal(verdict.destructive, false, "plain email typing needs no gate");
});

test("preview rejects unknown tool and unknown ref", () => {
  resetRegistry();
  const doc = page();
  enumerateInteractive(doc);
  assert.equal(previewAction(doc, { tool: "dance", ref: "el_1" }).ok, false);
  assert.equal(previewAction(doc, { tool: "click", ref: "el_9999" }).reason, "unknown-ref");
  assert.equal(previewAction(doc, { tool: "scroll" }).ok, true, "scroll previews ref-free");
});

test("click executes against the live node", () => {
  resetRegistry();
  const doc = page();
  const go = enumerateInteractive(doc).find((e) => e.label === "Log in");
  const res = executeAction(doc, null, { tool: "click", ref: go.ref });
  assert.equal(res.ok, true);
  assert.equal(byId(doc, "go").clicked, 1);
});

test("type sets value with focus; rejects buttons and missing text", () => {
  resetRegistry();
  const doc = page();
  const all = enumerateInteractive(doc);
  const email = all.find((e) => e.label === "Email");
  const res = executeAction(doc, null, { tool: "type", ref: email.ref, text: "testmail@gmail.com" });
  assert.equal(res.ok, true);
  const node = byId(doc, "email");
  assert.equal(node.value, "testmail@gmail.com");
  assert.equal(node.focused, 1);
  const del = all.find((e) => e.label === "Delete Account");
  assert.equal(executeAction(doc, null, { tool: "type", ref: del.ref, text: "x" }).reason, "not-typeable");
  assert.equal(executeAction(doc, null, { tool: "type", ref: email.ref }).reason, "bad-arguments");
});

test("select_option validates the value", () => {
  resetRegistry();
  const doc = page();
  const pick = enumerateInteractive(doc).find((e) => e.label === "Choice");
  assert.ok(pick, "select enumerated");
  // Model real <select> semantics: unmatched values don't stick.
  const sel = byId(doc, "pick");
  delete sel.value;
  let selVal = "";
  Object.defineProperty(sel, "value", {
    get: () => selVal,
    set: (v) => { if (["a", "b"].includes(String(v))) selVal = String(v); },
    configurable: true,
  });
  assert.equal(executeAction(doc, null, { tool: "select_option", ref: pick.ref, value: "a" }).ok, true);
  assert.equal(selVal, "a");
  assert.equal(
    executeAction(doc, null, { tool: "select_option", ref: pick.ref, value: "z" }).reason,
    "invalid-option"
  );
  const email = enumerateInteractive(doc).find((e) => e.label === "Email");
  assert.equal(
    executeAction(doc, null, { tool: "select_option", ref: email.ref, value: "a" }).reason,
    "not-typeable"
  );
});

test("submit requests the owning form; orphans fail honestly", () => {
  resetRegistry();
  const doc = page();
  const go = enumerateInteractive(doc).find((e) => e.label === "Log in");
  // Wire fixture form ownership (real DOM provides .form natively).
  byId(doc, "go").form = byId(doc, "login");
  const res = executeAction(doc, null, { tool: "submit", ref: go.ref });
  assert.equal(res.ok, true);
  assert.equal(byId(doc, "login").submitted, 1);
  const del = enumerateInteractive(doc).find((e) => e.label === "Delete Account");
  assert.equal(executeAction(doc, null, { tool: "submit", ref: del.ref }).reason, "no-form");
});

test("scroll drives the window; bad direction rejected", () => {
  const calls = [];
  const win = { scrollBy: (opts) => void calls.push(opts) };
  assert.equal(executeAction(null, win, { tool: "scroll", direction: "down", amount: 500 }).ok, true);
  assert.deepEqual(calls[0].top, 500);
  assert.equal(executeAction(null, win, { tool: "scroll", direction: "sideways" }).reason, "bad-arguments");
});

test("stale refs fail instead of acting on the wrong node", () => {
  resetRegistry();
  const doc = page();
  const go = enumerateInteractive(doc).find((e) => e.label === "Log in");
  resetRegistry(); // registry wiped: ref no longer resolves
  const res = executeAction(doc, null, { tool: "click", ref: go.ref });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unknown-ref");
  assert.equal(byId(doc, "go").clicked, 0, "no click leaked through");
});
