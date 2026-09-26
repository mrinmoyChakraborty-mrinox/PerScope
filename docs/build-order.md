# PerScope — Build Order

> **Superseded by root README §7.7 (Who Builds What) and the live tracker `LIST.md`.** Steps 1–10 below are the stale v3 time-boxed plan (tiered escalation, Qwen, Florence) retained for record. Build against README §7 instead.

> Sorted by **Build Step**, not Task ID. Tracker grew from single-VLM to three extractors + three-tier redaction + required server — MVP is re-cut below.

## Steps 1–10

### 1. Extension foundation — Manifest V3 + WS client + keepalive + Firefox decision
**Owner:** Person 4 + Person 1 | **Risk:** low | **Gate:** `chrome.runtime` WebSocket connects from 116+, `tabs`+`scripting` permissions declared, keepalive `ping`/`pong` every 20s proven in service worker.

- Manifest `minimum_chrome_version: 116`, `permissions: [tabs, scripting, offscreen, storage]`.
- `background.js` WS client multiplexes Playground/Bridge/Server on one URL, no branching per caller.
- Decide Firefox: **build real Firefox (MV3 + `browser_specific_settings`)** or document **Chrome-first, Firefox-compatible** — do not leave silent.

### 2. Fast-path privacy — Tier 0 regex/checksum + password masking
**Owner:** Person 3 | **Risk:** lowest — still ships first.

- OpenRedaction as base for regex/patterns (`sam247/openredaction`); add checksum (Luhn, etc).
- Runs on **both** DOM values (trusted) and OCR text (trusted only at high PaddleOCR confidence; low-confidence or failed checksum → escalate to Tier 1, never clear).
- Password fields masked regardless of detection.

### 3. Local perception — Offscreen + three extractors (crude output OK first)
**Owner:** Person 2 (Jeet) | **Risk:** medium (Florence experimental).

- `offscreen.html`/`offscreen.js` hosts 4 models: DOM Extractor (native), PaddleOCR, Florence-2-base, Qwen 2B (Tier 2, co-owned with Person 3). Profile memory/load.
- PaddleOCR must expose **per-token confidence** — Tier 0 depends on it.
- Florence-2 ONNX browser support is experimental — agree fallback **DOM+OCR only** with Person 3.
- Test WebGPU + WASM per-model; benchmark on real demo page.

### 4. Tiered detection + local reasoning — Tier1 Ettin + Tier2 Qwen 2B + deterministic redaction + self-audit
**Owner:** Person 3 (Koyel) + Person 2 (offscreen hosting) | **Risk:** high (new LLM integration).

- Tier1: `kalyan-ks/ettin-68m-nemotron-pii` on residual text → **candidates**, not auto-redactions.
- Tier2: Qwen 2B (`Qwen/Qwen3.5-2B`) adjudicates candidates → **Sanitization Plan** (internal, never transmitted).
- Deterministic redactor executes plan (DOM values + image bboxes).
- Self-audit: re-run Tier0+Tier1 on **output**; fail-closed if hit remains.

### 5. Core integration — Pipeline → action execution + validator
**Owner:** Person 1 + Person 4 | **Risk:** medium.

- Wire `list_interactive_elements` through 3 extractors → tiered → plan → redact → audit → response.
- `isDestructive()` gates `click`/`type`/`submit`/`select_option` uniformly for all three callers.

### 6. Playground + MCP Bridge
**Owner:** Person 5 (Banashree) | **Priority:** high (demo proof).

- Node WS server, scripted demo, "what agent sees" panel.
- Bridge: thin `stdio ⇄ WebSocket` translator, zero logic, auto-spawned; translates `tools/list`/`tools/call` ↔ `{id,tool,params}`.

### 7. PerScope Reasoning Server — **REQUIRED, start parallel with Step 6 (not after)**
**Owner:** Person 5 + Person 1 | **Risk:** highest net-new scope.

- Self-host Qwen3 family (not 2.5) via **vLLM or Ollama** (rented GPU for SIH latency is permitted — state it).
- Constrain output to 7-tool schema via structured/function-calling (never free prose).
- Multi-turn: can return action or `scroll`+re-evaluate.
- Integration-test against real merged payload as soon as step 4 produces real output — not mocked.

### 8. Security demo + end-to-end integration
**Owner:** Person 1 + 4 + 5

- Staged destructive-action + prompt-injection scenarios tested against **all three** WS clients.
- Prove `action_update` push works for Playground/Server; document MCP gap.

### 9. Human Mode — Popup Capture flow + Chat Destination & Injection Layer
**Owner:** Person 4 (Shritama) | **Scope decision needed.**

- Popup: tab selector, Capture, live progress, Capture Review (Visual+Context, clean/ambiguous/blocked), Send / Send & Submit.
- Chat Injection: tab discovery for known AI chats, 2–3 per-site adapters + clipboard fallback, via `content.js`.
- First cut if time runs short — differentiator, not PS requirement.

### 10. Final QA + Pitch
**Owner:** Person 6 (Adreeja) + all

- Deck, honest limitations, backup video (include one destructive block via Reasoning Server if time allows), competitive (Nanobrowser), WebGPU/WASM per-model QA.

---

## MVP Re-cut (honest)

**See (3 extractors, Florence degradable to DOM+OCR) → sanitize (Tier0+Tier1 core, Tier2 Qwen 2B degradable to conservative default) → prove it → act safely (validator, same for all callers) via required Reasoning Server (minimal Qwen3 deployment satisfies PS).**

### What to cut first (in order)

1. Human Mode Capture/Send-to-Chat — strong, not required.
2. Face redaction — name as known limitation (see `limitations.md`).
3. Florence-2-base — degrade to DOM+OCR.
4. Tier2 Qwen 2B — degrade to escalate all Tier1 candidates conservatively.

### What cannot be cut (literal PS requirement)

Local perception + tiered detection + deterministic redaction + self-audit + validator + **working Reasoning Server** demonstrating one real end-to-end task.

## Target Demo Flow (updated)

1. Page with name/email/phone/password, Delete Account button, hidden injection text.
2. Playground *or* Reasoning Server sends `read_page`.
3. Side panel shows live detection across three extractors.
4. Privacy Log shows per-tier hits.
5. Caller receives sanitized JSON (no raw screenshot/PII).
6. Form fill+submit succeeds — redaction didn't break task.
7. Hidden destructive action → Security Log blocks (`destructive_action_unconfirmed`).
8. If time: repeat 7 with different caller to prove "same validator, any source".

## Tracker Maintenance

- Every task lists owner + step + dependency.
- Scope note at top is not boilerplate — re-confirm MVP as team before building literally against old tracker.
