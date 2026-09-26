# PerScope � Tool Schema Reference
### Used identically by the WebSocket Bridge path and the MCP bridge path (as-built: root README �7.2, bridge 0.1.0+multiplexing)
> **As-built:** confirm flow is a **blocking tool call** � the bridge holds each gated call until the extension answers `ok` / `denied` / `timeout` (=60s). No polling tool, no push dependency. WS callers authenticate per-message (`auth` top-level, `role:"agent"` declared at pair/hello; extension sockets receive, agent sockets send). Agent setup: `claude mcp add perscope -- npx -y @perscope/bridge mcp` (stdio proxy ? singleton daemon); remote agents use the streamable-HTTP transport with identical handlers.

Both paths expose the **same nine tools**. For every tool below, **Input** and **Output** are shown as two separate blocks � not combined � so it's unambiguous which side is which.

---

## 1. WebSocket Schema (Playground / PerScope Reasoning Server / MCP Bridge)

**Envelope shape, in general:**

**Input (caller ? extension):**
```json
{ "id": "req_123", "tool": "<tool_name>", "params": { ... }, "auth": "<token>" }
```

**Output (extension ? caller):**
```json
{ "id": "req_123", "status": "ok", "result": { ... } }
```
or, on a gated verdict (`denied` / `timeout`) or an error:
```json
{ "id": "req_123", "status": "denied" }
{ "id": "req_123", "status": "timeout" }
{ "id": "req_123", "status": "error", "reason": "..." }
```
> Historical note: earlier drafts used `{status:"blocked", reason, pending_id}` plus an unsolicited `action_update` push � that protocol is dead (see � Confirm-flow push, retained for record).

---

### `capture_tab`
Triggers the tested image pipeline (BlazeFace + PaddleOCR per-box + Ettin NER + heuristics + FastVLM adjudication ? fusion ? safety gates ? value-only geometry ? canvas redaction). **Gated by validator: No (read-only).**

**Input:**
```json
{ "id": "req_000", "tool": "capture_tab", "params": {} }
```

**Output:**
```json
{ "id": "req_000", "status": "ok", "result": {
    "redacted_image": "<base64 PNG>",
    "findings": [ { "candidate_id": "cand_1", "type": "EMAIL", "confidence": 0.94 } ],
    "caption": "ID card with [REDACTED:EMAIL] visible...",
    "timings": { "ocr_ms": 1200, "ner_ms": 800 }
} }
```

---

### `read_page`
DOM Phase 1 as-built: content-script snapshot walk + Tier0-per-segment redaction (`piidetector.js` regex/validators; Ettin NER stays out of the DOM path) + label?value association, mapped to `{sanitizedText, findings}` (as-built `mapDomCaptureToReadPage`; allowlisted fields only). No FastVLM by default (`FASTVLM_FOR_DOM` opt-in). **Gated by validator: No.**

**Input:**
```json
{ "id": "req_001", "tool": "read_page", "params": {} }
```

**Output:**
```json
{ "id": "req_001", "status": "ok", "result": {
    "url": "...",
    "title": "...",
    "summary": "...",
    "element_count": 6,
    "page_height": 2400
} }
```

---

### `list_interactive_elements`
Triggers the full local pipeline: content.js ? extractors (DOM text + image-path BlazeFace/PaddleOCR where applicable) ? detection (Ettin-68M NER + deterministic heuristics + FastVLM adjudication for image mode) ? fusion ? safety gates ? value-only geometry ? text/canvas redaction ? response. **Gated by validator: No (read-only).**

**Input:**
```json
{ "id": "req_002", "tool": "list_interactive_elements", "params": {} }
```

**Output:**
```json
{ "id": "req_002", "status": "ok", "result": {
    "elements": [
      {
        "id": "el_1",
        "type": "input",
        "input_type": "email",
        "label": "Email",
        "value": "[EMAIL]",
        "bbox": [120, 80, 200, 24],
        "page_height": 2400,
        "enabled": true
      },
      {
        "id": "el_3",
        "type": "button",
        "label": "Delete Account",
        "bbox": [120, 1900, 140, 32],
        "page_height": 2400,
        "enabled": true
      }
    ]
} }
```

**Notes (as-built, supersedes the paragraph below):** refs come from the content-script registry (`el_1�`, opaque, per page load) � `[{ref, tag, label, role}]`, no bboxes, no locator internals. Re-listing an unchanged page returns identical refs; genuinely new elements mint new ones; removed/changed targets resolve `stale_element`. The bbox/absolute-coordinate design below is retained for record only.

---

### `list_tabs`
New in D4 (Manual tab picker): enumerate open tabs for targeting. No `tabs` permission key � ids always; titles/URLs ride `<all_urls>`, with `titlesAvailable` reporting whether they arrived populated (empirical D4 answer arrives live; fallback = one-line `tabs` key). **Gated by validator: No.**

**Input:**
```json
{ "id": "req_003", "tool": "list_tabs", "params": {} }
```

**Output:**
```json
{ "id": "req_003", "status": "ok", "result": {
    "tabs": [{ "tabId": 11, "title": "Inbox", "url": "https://...", "active": true }],
    "titlesAvailable": true
} }
```

---

### `click`
**Gated by validator: Yes (wiring pending � T6d; currently answers honest errors).**

**Input:**
```json
{ "id": "req_011", "tool": "click", "params": { "ref": "el_3" } }
```

**Output � terminal shapes (blocking contract; `blocked`+`pending_id` below is the dead draft, kept one block for record):**

Cleared:
```json
{ "id": "req_011", "status": "ok" }
```
Blocked (destructive, awaiting human confirmation):
```json
{ "id": "req_011", "status": "blocked", "reason": "destructive_action_unconfirmed", "pending_id": "pend_88" }
```
Error (stale target):
```json
{ "id": "req_011", "status": "error", "reason": "stale_element" }
```

---

### `type`
**Gated by validator: Yes.**

**Input:**
```json
{ "id": "req_012", "tool": "type", "params": { "ref": "el_1", "value": "user@example.com" } }
```

**Output:**
```json
{ "id": "req_012", "status": "ok" }
```
(Same `blocked` / `error` shapes as `click` also apply here.)

---

### `submit`
**Gated by validator: Yes.**

**Input:**
```json
{ "id": "req_013", "tool": "submit", "params": { "ref": "el_5" } }
```

**Output:**
```json
{ "id": "req_013", "status": "ok" }
```
(Same `blocked` / `error` shapes as `click` also apply here.)

---

### `select_option`
For `<select>` dropdowns that `click` + `type` can't cover. Routed through the same validator path as the others, for consistency, even though rarely flagged. **Gated by validator: Yes.**

**Input:**
```json
{ "id": "req_014", "tool": "select_option", "params": { "ref": "el_5", "value": "India" } }
```

**Output:**
```json
{ "id": "req_014", "status": "ok" }
```
(Same `blocked` / `error` shapes as `click` also apply here.)

---

### `scroll`
`amount` accepts `"page"` or a raw pixel integer. **Gated by validator: No.**

**Input:**
```json
{ "id": "req_010", "tool": "scroll", "params": { "direction": "down", "amount": "page" } }
```

**Output:**
```json
{ "id": "req_010", "status": "ok", "result": { "scroll_y": 800 } }
```

---

### Confirm-flow push — HISTORICAL RECORD (dead protocol, do not implement)

This has **no Input** � it's never triggered by a caller request. It's sent unsolicited, correlated by `pending_id` instead of a request `id`, after a human acts (or fails to act) on a blocked action in the side panel.

**Output only (extension ? caller, unsolicited):**
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "ok", "action": "click", "ref": "el_3", "result": { "executed": true } }
```
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "denied" }
```
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "timeout" }
```

---

### Keepalive � not a tool

**Input:**
```json
{ "type": "ping" }
```

**Output:**
```json
{ "type": "pong" }
```

---

## 2. MCP Schema (Real Agent � Claude Code, Codex, etc., via the bridge)

The bridge registers these nine tools with the MCP host using standard MCP `tools/list` + `tools/call` semantics. For each tool, **Input** is the `inputSchema` the bridge advertises to the agent; **Output** is what the agent receives back � the WebSocket response's `result` field, passed through unchanged, with no reinterpretation.

---

### `read_page`

**Input (schema advertised to the agent):**
```json
{
  "name": "read_page",
  "description": "Return lightweight metadata about the active page. Does not trigger the perception pipeline � cheap, safe to call freely.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] }
}
```

**Output (returned to the agent):**
```json
{ "url": "...", "title": "...", "summary": "...", "element_count": 6, "page_height": 2400 }
```

---

### `list_interactive_elements`

**Input:**
```json
{
  "name": "list_interactive_elements",
  "description": "Enumerate clickable/typeable elements with stable opaque refs from the content-script registry. Re-listing an unchanged page returns identical refs.",
  "inputSchema": { "type": "object", "properties": { "tabId": { "type": "integer" } }, "required": [] }
}
```

**Output:**
```json
{ "elements": [ { "ref": "el_1", "tag": "input", "label": "Email", "role": "textbox" } ] }
```

---

### `list_tabs`

**Input:**
```json
{
  "name": "list_tabs",
  "description": "List open tabs the extension can see for targeting tabId in other tools. Omit tabId elsewhere to use the active tab.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] }
}
```

**Output:**
```json
{ "tabs": [{ "tabId": 11, "title": "Inbox", "url": "https://...", "active": true }], "titlesAvailable": true }
```

---

### `click`

**Input:**
```json
{
  "name": "click",
  "description": "Click the element with the given ref. Registry ref from list_interactive_elements; re-resolved live on every call (stale_element only on genuine mismatch). Gated by the extension validator once wired (T6d) � gated calls block until the terminal ok / denied / timeout.",
  "inputSchema": {
    "type": "object",
    "properties": { "ref": { "type": "string" } },
    "required": ["ref"]
  }
}
```

**Output � one of (terminal; the `blocked`+`pending_id` draft below is dead, kept for record):**
```json
{ "status": "ok" }
```
```json
{ "status": "denied" }
```
```json
{ "status": "timeout" }
```
```json
{ "status": "blocked", "reason": "destructive_action_unconfirmed", "pending_id": "pend_88" }
```
```json
{ "status": "error", "reason": "stale_element" }
```

---

### `type`

**Input:**
```json
{
  "name": "type",
  "description": "Type a value into the element with the given id. Gated by the same local validator as click.",
  "inputSchema": {
    "type": "object",
    "properties": { "ref": { "type": "string" }, "value": { "type": "string" } },
    "required": ["ref", "value"]
  }
}
```

**Output:** same three shapes as `click`.

---

### `submit`

**Input:**
```json
{
  "name": "submit",
  "description": "Submit the form associated with the element with the given id. Gated by the same local validator as click.",
  "inputSchema": {
    "type": "object",
    "properties": { "ref": { "type": "string" } },
    "required": ["ref"]
  }
}
```

**Output:** same three shapes as `click`.

---

### `select_option`

**Input:**
```json
{
  "name": "select_option",
  "description": "Select an option in a <select> dropdown identified by ref. Gated by the same local validator as click, for consistency, though rarely flagged.",
  "inputSchema": {
    "type": "object",
    "properties": { "ref": { "type": "string" }, "value": { "type": "string" } },
    "required": ["ref", "value"]
  }
}
```

**Output:** same three shapes as `click`.

---

### `scroll`

**Input:**
```json
{
  "name": "scroll",
  "description": "Scroll the page. amount accepts the literal string 'page' or a raw pixel integer. Never gated by the validator.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "direction": { "type": "string", "enum": ["up", "down"] },
      "amount": { "oneOf": [ { "type": "string", "enum": ["page"] }, { "type": "integer" } ] }
    },
    "required": ["direction", "amount"]
  }
}
```

**Output:**
```json
{ "scroll_y": 800 }
```

---

### How a blocked/pending result surfaces to an MCP agent � RESOLVED (blocking call)

**Locked decision (root README �7.2):** the bridge holds the MCP `tools/call` open until the extension resolves the confirm flow. The agent receives exactly one terminal response: `{status:"ok"}` (approved/cleared), `{status:"denied"}`, or `{status:"timeout"}` (60s). No polling tool, no push dependency. The `action_update`-push gap described below is retained for record only.

> Historical gap (superseded): MCP's `tools/call` is request/response only � it has no concept of an unsolicited server push. The confirm-flow's `action_update` (Section 1) is exactly that: outbound-only, no matching request `id`. This means:

- **Input:** the agent calls `click` as normal.
- **Output the agent actually receives, if blocked:** just `{ "status": "blocked", "reason": "destructive_action_unconfirmed", "pending_id": "pend_88" }` � that's the entire result of the call. MCP can't hold the call open waiting on a human side-panel action.
- **What's missing:** there is currently no way for the agent to later learn whether that pending action was approved, denied, or timed out � the WebSocket protocol assumes a caller sitting and listening for the `action_update` push, which an MCP `tools/call` cannot do. **This is a real gap to close before finals** � likely via a new polling tool (e.g. `check_pending_action`) or by having the bridge hold the MCP response open until the push arrives, if the MCP transport in use allows it.

---

## 3. Constraint on PerScope's Own Reasoning Server

**Input the server receives:** the sanitized context only (from `list_interactive_elements`'s output) � never raw page data.

**Output the server must produce:** structured/function-calling output constrained to exactly the nine tool names and parameter shapes above — never free-form prose actions. This is what lets the same validator, the same Dashboard logging, and the same confirm-flow apply uniformly whether the caller is a real MCP agent, the Playground, or PerScope's own hosted model.