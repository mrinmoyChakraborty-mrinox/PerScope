import assert from "node:assert/strict";
import test from "node:test";
import {
  enumerateInteractive,
  resolveRef,
  resetRegistry,
  walkDomPath,
} from "../src/content/refs.js";
import { buildDomPath } from "../src/pipeline/dom-capture.js";

// Minimal fixture DOM (same node contract as dom-capture.test.mjs).
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
  };
  for (let child of children) {
    if (typeof child === "string") child = txt(child);
    child.parentNode = node;
    child.parentElement = node;
    node.childNodes.push(child);
  }
  return node;
}
function descendants(root, out = []) {
  for (const c of root.childNodes || []) {
    out.push(c);
    if (c.nodeType === 1) descendants(c, out);
  }
  return out;
}
function makeDocument(body) {
  const doc = {
    nodeType: 9,
    childNodes: [],
    parentNode: null,
    ownerDocument: null,
    querySelector(sel) {
      const m = String(sel).match(/^label\[for="([^"]+)"\]$/i);
      if (!m) return null;
      return descendants(this).find(
        (n) => n.nodeType === 1 && String(n.tagName).toLowerCase() === "label" && n.getAttribute("for") === m[1]
      ) || null;
    },
  };
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
function serialize(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType === 9) return (node.childNodes || []).map(serialize).join("");
  const attrs = Object.entries(node.attributes || {})
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<${String(node.tagName).toLowerCase()}${attrs}>${(node.childNodes || []).map(serialize).join("")}</${String(node.tagName).toLowerCase()}>`;
}

function loginPage() {
  return makeDocument(
    el("body", {}, [
      el("form", { id: "login" }, [
        el("label", { for: "email" }, ["Email"]),
        el("input", { id: "email", name: "email", type: "text" }),
        el("label", { for: "pw" }, ["Password"]),
        el("input", { id: "pw", name: "pw", type: "password" }),
        el("button", { type: "submit" }, ["Log in"]),
        el("a", { href: "/forgot" }, ["Forgot password?"]),
        el("input", { id: "secret", type: "hidden", value: "x" }),
      ]),
    ])
  );
}

test("enumerate returns opaque ref/tag/label/role with no locator internals", () => {
  resetRegistry();
  const out = enumerateInteractive(loginPage());
  assert.equal(out.length, 4, `expected email+pw inputs, button, link — got ${JSON.stringify(out.map((e) => e.tag + ":" + e.label))}`);
  for (const item of out) {
    assert.deepEqual(Object.keys(item).sort(), ["label", "ref", "role", "tag"]);
    assert.match(item.ref, /^el_\d+$/);
    assert.ok(!("domPath" in item) && !("element" in item));
  }
  const byTag = Object.fromEntries(out.map((e) => [e.tag + ":" + e.label, e.role]));
  assert.equal(byTag["button:Log in"], "button");
  assert.equal(byTag["a:Forgot password?"], "link");
  assert.equal(byTag["input:Email"], "textbox");
});

test("hidden inputs and href-less anchors are skipped; roles map", () => {
  resetRegistry();
  const doc = makeDocument(
    el("body", {}, [
      el("input", { type: "hidden", value: "x" }),
      el("a", {}, ["nowhere"]),
      el("select", { name: "c" }, []),
      el("textarea", { name: "t" }, []),
      el("input", { type: "checkbox", name: "cb" }, []),
    ])
  );
  const out = enumerateInteractive(doc);
  const tags = out.map((e) => e.tag);
  assert.ok(!tags.includes("nowhere") && out.every((e) => e.label !== "nowhere"));
  assert.ok(!out.some((e) => e.tag === "input" && e.label === "x"));
  const roles = Object.fromEntries(out.map((e) => [e.tag, e.role]));
  assert.equal(roles.select, "combobox");
  assert.equal(roles.textarea, "textbox");
  assert.equal(roles.input, "checkbox");
});

test("re-list without changes keeps refs; new elements mint new refs", () => {
  resetRegistry();
  const doc = makeDocument(el("body", {}, [el("button", { id: "b1" }, ["Go"])]));
  const first = enumerateInteractive(doc);
  const second = enumerateInteractive(doc);
  assert.deepEqual(first, second);
  doc.body.childNodes.push(el("button", { id: "b2" }, ["Stop"]));
  doc.body.childNodes[doc.body.childNodes.length - 1].parentNode = doc.body;
  doc.body.childNodes[doc.body.childNodes.length - 1].ownerDocument = doc;
  const third = enumerateInteractive(doc);
  assert.equal(third.length, 2);
  assert.equal(third[0].ref, first[0].ref);
  assert.notEqual(third[1].ref, first[0].ref);
});

test("resolveRef finds the live element", () => {
  resetRegistry();
  const doc = loginPage();
  const out = enumerateInteractive(doc);
  const target = out.find((e) => e.label === "Log in");
  const resolved = resolveRef(doc, target.ref);
  assert.ok(!resolved.stale);
  assert.equal(String(resolved.element.tagName).toLowerCase(), "button");
});

test("mutation: removed node resolves stale (genuine mismatch)", () => {
  resetRegistry();
  const doc = loginPage();
  const out = enumerateInteractive(doc);
  const target = out.find((e) => e.label === "Log in");
  const form = descendants(doc).find((n) => n.tagName === "FORM");
  form.childNodes = form.childNodes.filter(
    (c) => !(c.nodeType === 1 && String(c.tagName).toLowerCase() === "button")
  );
  const resolved = resolveRef(doc, target.ref);
  assert.deepEqual(resolved, { stale: true, reason: "stale_element" });
});

test("mutation: trivia does not go stale (own label edit, unrelated text edit)", () => {
  resetRegistry();
  const doc = loginPage();
  const out = enumerateInteractive(doc);
  const target = out.find((e) => e.label === "Log in");
  // Edit the element's own label text and unrelated page text.
  const btn = descendants(doc).find(
    (n) => n.nodeType === 1 && String(n.tagName).toLowerCase() === "button"
  );
  btn.childNodes[0].nodeValue = "Sign in";
  const firstText = descendants(doc).find((n) => n.nodeType === 3 && n.nodeValue.trim());
  if (firstText) firstText.nodeValue = firstText.nodeValue + "!";
  const resolved = resolveRef(doc, target.ref);
  assert.ok(!resolved.stale, "label/unrelated edits must not stale a live element");
  assert.equal(String(resolved.element.tagName).toLowerCase(), "button");
});

test("mutation: tag swap and id change go stale", () => {
  resetRegistry();
  const doc = loginPage();
  const out = enumerateInteractive(doc);
  const email = out.find((e) => e.label === "Email");
  // Swap tag at the recorded path: replace input with a span carrying same id.
  const input = descendants(doc).find((n) => n.nodeType === 1 && n.getAttribute("id") === "email");
  const parent = input.parentNode;
  const idx = parent.childNodes.indexOf(input);
  const impostor = el("span", { id: "email" }, ["Email"]);
  impostor.parentNode = parent;
  impostor.ownerDocument = doc;
  parent.childNodes[idx] = impostor;
  assert.deepEqual(resolveRef(doc, email.ref), { stale: true, reason: "stale_element" });
});

test("mutation: recorded id change goes stale", () => {
  resetRegistry();
  const doc = loginPage();
  const out = enumerateInteractive(doc);
  const email = out.find((e) => e.label === "Email");
  const input = descendants(doc).find((n) => n.nodeType === 1 && n.getAttribute("id") === "email");
  input.attributes.id = "email2";
  assert.deepEqual(resolveRef(doc, email.ref), { stale: true, reason: "stale_element" });
});

test("enumeration is read-only and unknown refs are stale", () => {
  resetRegistry();
  const doc = loginPage();
  const before = serialize(doc);
  enumerateInteractive(doc);
  enumerateInteractive(doc);
  assert.equal(serialize(doc), before);
  assert.deepEqual(resolveRef(doc, "el_999"), { stale: true, reason: "unknown-ref" });
});

test("walkDomPath round-trips buildDomPath on the fixture", () => {
  resetRegistry();
  const doc = loginPage();
  const input = descendants(doc).find((n) => n.nodeType === 1 && n.getAttribute("id") === "pw");
  assert.equal(walkDomPath(doc, buildDomPath(input)), input);
});
