# PerScope — Tool Schema Reference
### Used identically by the WebSocket Playground/Reasoning Server path and the MCP bridge path

Both paths expose the **same seven tools**. For every tool below, **Input** and **Output** are shown as two separate blocks — not combined — so it's unambiguous which side is which.

---

## 1. WebSocket Schema (Playground / PerScope Reasoning Server / MCP Bridge)

**Envelope shape, in general:**

**Input (caller → extension):**
```json
{ "id": "req_123", "tool": "<tool_name>", "params": { ... } }
```

**Output (extension → caller):**
```json
{ "id": "req_123", "status": "ok", "result": { ... } }
```
or, if blocked:
```json
{ "id": "req_123", "status": "blocked", "reason": "...", "pending_id": "..." }
```
or, if an error:
```json
{ "id": "req_123", "status": "error", "reason": "..." }
```

---

### `read_page`
Cheap. No perception pipeline triggered. **Gated by validator: No.**

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
Triggers the full local pipeline: content.js → three parallel extractors (DOM Extractor, PaddleOCR, Florence-2-base) → tiered detection (regex/checksum → Ettin-68M NER → Qwen 2B) → Sanitization Plan → deterministic redaction → self-audit → response. **Gated by validator: No (read-only).**

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

**Notes:** `bbox` is absolute page coordinates, not viewport-relative — combined with `page_height`, this is how a caller determines whether it needs to `scroll` before a `click` will land. Returns *all* elements, not just currently visible ones. Element `id`s are ephemeral — valid only until the next call to this tool.

---

### `click`
**Gated by validator: Yes.**

**Input:**
```json
{ "id": "req_011", "tool": "click", "params": { "element_id": "el_3" } }
```

**Output — three possible shapes:**

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
{ "id": "req_012", "tool": "type", "params": { "element_id": "el_1", "value": "user@example.com" } }
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
{ "id": "req_013", "tool": "submit", "params": { "element_id": "el_5" } }
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
{ "id": "req_014", "tool": "select_option", "params": { "element_id": "el_5", "value": "India" } }
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

### Confirm-flow push — outbound only, not a request/response pair

This has **no Input** — it's never triggered by a caller request. It's sent unsolicited, correlated by `pending_id` instead of a request `id`, after a human acts (or fails to act) on a blocked action in the side panel.

**Output only (extension → caller, unsolicited):**
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "ok", "action": "click", "element_id": "el_3", "result": { "executed": true } }
```
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "denied" }
```
```json
{ "type": "action_update", "pending_id": "pend_88", "status": "timeout" }
```

---

### Keepalive — not a tool

**Input:**
```json
{ "type": "ping" }
```

**Output:**
```json
{ "type": "pong" }
```

---

## 2. MCP Schema (Real Agent — Claude Code, Codex, etc., via the bridge)

The bridge registers these seven tools with the MCP host using standard MCP `tools/list` + `tools/call` semantics. For each tool, **Input** is the `inputSchema` the bridge advertises to the agent; **Output** is what the agent receives back — the WebSocket response's `result` field, passed through unchanged, with no reinterpretation.

---

### `read_page`

**Input (schema advertised to the agent):**
```json
{
  "name": "read_page",
  "description": "Return lightweight metadata about the active page. Does not trigger the perception pipeline — cheap, safe to call freely.",
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
  "description": "Run the full local perception and sanitization pipeline and return every interactive element with type, label, sanitized value, absolute bounding box, and page height. Values are already redacted before this tool returns — the raw page is never exposed to the caller.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] }
}
```

**Output:**
```json
{ "elements": [ { "id": "el_1", "type": "input", "label": "Email", "value": "[EMAIL]", "bbox": [120,80,200,24], "enabled": true } ] }
```

---

### `click`

**Input:**
```json
{
  "name": "click",
  "description": "Click the element with the given id. Ephemeral id from the most recent list_interactive_elements call. Gated by a local validator — destructive actions return a blocked status pending human confirmation rather than executing immediately.",
  "inputSchema": {
    "type": "object",
    "properties": { "element_id": { "type": "string" } },
    "required": ["element_id"]
  }
}
```

**Output — one of:**
```json
{ "status": "ok" }
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
    "properties": { "element_id": { "type": "string" }, "value": { "type": "string" } },
    "required": ["element_id", "value"]
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
    "properties": { "element_id": { "type": "string" } },
    "required": ["element_id"]
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
  "description": "Select an option in a <select> dropdown identified by element_id. Gated by the same local validator as click, for consistency, though rarely flagged.",
  "inputSchema": {
    "type": "object",
    "properties": { "element_id": { "type": "string" }, "value": { "type": "string" } },
    "required": ["element_id", "value"]
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

### How a blocked/pending result surfaces to an MCP agent — known gap

MCP's `tools/call` is request/response only — it has no concept of an unsolicited server push. The confirm-flow's `action_update` (Section 1) is exactly that: outbound-only, no matching request `id`. This means:

- **Input:** the agent calls `click` as normal.
- **Output the agent actually receives, if blocked:** just `{ "status": "blocked", "reason": "destructive_action_unconfirmed", "pending_id": "pend_88" }` — that's the entire result of the call. MCP can't hold the call open waiting on a human side-panel action.
- **What's missing:** there is currently no way for the agent to later learn whether that pending action was approved, denied, or timed out — the WebSocket protocol assumes a caller sitting and listening for the `action_update` push, which an MCP `tools/call` cannot do. **This is a real gap to close before finals** — likely via a new polling tool (e.g. `check_pending_action`) or by having the bridge hold the MCP response open until the push arrives, if the MCP transport in use allows it.

---

## 3. Constraint on PerScope's Own Reasoning Server

**Input the server receives:** the sanitized context only (from `list_interactive_elements`'s output) — never raw page data.

**Output the server must produce:** structured/function-calling output constrained to exactly the seven tool names and parameter shapes above — never free-form prose actions. This is what lets the same validator, the same Dashboard logging, and the same confirm-flow apply uniformly whether the caller is a real MCP agent, the Playground, or PerScope's own hosted model.