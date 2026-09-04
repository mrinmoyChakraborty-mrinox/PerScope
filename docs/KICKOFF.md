# PerScope — Kickoff: What Each Person Needs to Add

> **Why this file exists:** The scaffolds for extension / bridge / server / playground that were previously generated in code have been **removed from the repo** (per team decision — each owner implements their own area). This doc is the single kickoff checklist — treat it as your "add these files" ticket. Nothing here is pre-implemented; everything below is **your task to create**.

## How to use this doc

1. Find your Person section below.
2. Create the listed files in your area (exact paths given).
3. Keep docs as source of truth — see linked `docs/tasks/*.md` for full acceptance criteria.
4. Log progress in `docs/CHANGELOG.md` (add `## YYYY-MM-DD — Area — Name` at top).
5. Do **not** claim Firefox/face/Florence done until you have proof — see `docs/limitations.md`.

---

## Person 1 — Team Lead / Systems Integration
**Docs:** `docs/tasks/01-lead-integration.md`, `docs/tool-schema.md`

**Add:**
- `extension/background/background.js` — WS client multiplexing Playground + Bridge + Reasoning Server on one `ws://localhost:8765`, 20s `ping`/`pong` keepalive (service worker would die otherwise), routing by `{id, tool}`, `isDestructive()` validator, `pendingActions: Map<pending_id>` with 60s timeout, `check_pending_action` polling for MCP gap.
- `docs/tool-schema.md` — ensure 7 tools (`read_page`, `list_interactive_elements`, `click`, `type`, `submit`, `select_option`, `scroll`) with envelope `{id, tool, params}` ↔ `{id, status:"ok"|"blocked"|"error"}` and `action_update` push. Decision with Person 5: polling vs held-open MCP response.

## Person 2 — Perception Engineer (Jeet)
**Docs:** `docs/tasks/02-perception.md`

**Add:**
- `extension/offscreen/offscreen.html` + `extension/offscreen/offscreen.js` — host **4 models** (PaddleOCR `V6_SMALL_MODEL` + Florence-2-base `onnx-community/Florence-2-base` + Ettin-68M + Qwen 2B) via Transformers.js + ONNX Runtime Web (WebGPU with WASM fallback). Profile memory/load time. PaddleOCR must expose **per-token confidence**.
- Helpers in `perception/` if you extract from `v3.mjs` (currently `v3.mjs` + `qwen_redaction_pure.mjs` hold the pipeline — keep them as reference, don't assume bbox conventions align).

## Person 3 — Privacy, Detection & Redaction (Koyel)
**Docs:** `docs/tasks/03-privacy-redaction.md`, `QWEN_REDACTION_PIPELINE_PLAN.md`, `qwen_redaction_pure.mjs`

**Add:**
- Tier0 in `piidetector.js` — regex + checksum on **both** DOM and OCR (OCR trusted only at high confidence, else escalate).
- Tier1 Ettin-68M (`kalyan-ks/ettin-68m-nemotron-pii` / `rulesentry-io/ettin-68m-nemotron-pii-onnx`) — candidates only, **not auto-redactions**.
- Tier2 Qwen 2B (`Qwen/Qwen3.5-2B`) adjudication → Sanitization Plan → **deterministic redactor** (DOM values + image bbox masking).
- Self-audit (re-run Tier0+Tier1 on output, fail-closed). Decide face redaction gap with Person 2 (add model or declare limitation).

## Person 4 — Browser Extension & Automation (Shritama)
**Docs:** `docs/tasks/04-extension-automation.md`

**Add:**
- `extension/manifest.json` — MV3, `minimum_chrome_version:"116"`, `permissions:["tabs","scripting","offscreen","storage"]`, `host_permissions:["<all_urls>"]`, `browser_specific_settings.gecko` (Firefox decision).
- `extension/content/content.js` — **only** live-DOM access: `list_interactive_elements` extraction, `click`/`type`/`submit`/`select_option`/`scroll`, plus **Chat Destination & Injection Layer** (`chat-adapters/` for ChatGPT/Claude/Gemini + clipboard fallback).
- `extension/popup/popup.html` + `popup.js/ps` — tab selector, **Capture** button, live progress (`page captured → text extracted → sensitive detected → sanitizing` + "Everything stays on this device"), **Capture Review** (Visual + Context views, states: `clean`/`ambiguous`/`blocked`), **Send** vs **Send & Submit**, destination picker.
- `extension/sidepanel/index.html` + `index.js` — live view + Approve/Deny for `pending_id`.
- `extension/dashboard/index.html` + `index.js` — Privacy Log (per capture: source, count/type, destination) + Security Log (blocked+confirm), redacted-only storage, Clear All.

## Person 5 — Server / Bridge / Playground (Banashree)
**Docs:** `docs/tasks/05-server-bridge-playground.md`

**Add:**
- `bridge/package.json` (`@modelcontextprotocol/sdk`, `ws`) + `bridge/index.js` — **thin** `stdio ⇄ WebSocket` translator, zero logic, advertises 7 tools + `check_pending_action` for MCP gap, auto-spawned.
- `playground/package.json` + `playground/index.html` + `playground/index.js` — Node WS + browser UI, scripted demo, "what the agent sees" (sanitized) panel, same 7-tool schema.
- `server/package.json` (`ws`, `ollama`) + `server/index.js` — **PerScope Reasoning Server** (required PS deliverable): self-hosted **Qwen3** (not 2.5) via vLLM/Ollama, constrained to 7-tool `response_format:json`, multi-turn (`scroll`-then-re-evaluate), rented GPU for SIH is permitted — state it.

## Person 6 — Research, QA & Pitch (Adreeja)
**Docs:** `docs/tasks/06-research-qa.md`, `docs/limitations.md`

**Add:**
- Deck + `docs/limitations.md` honest slide (face, Firefox, Florence experimental, Qwen memory, MCP gap).
- **Citation fixes:** offscreen pattern = "community-proven" (not HF Gemma reference), server = **Qwen3** (not 2.5).
- QA: WebGPU vs WASM per-model (4 models), backup video including one destructive block via **Reasoning Server**.

---

## What was removed (for transparency)

The following scaffolds were generated earlier and **deleted per this kickoff decision** (so owners can implement without merge conflicts):
`extension/manifest.json`, `extension/background/background.js`, `extension/offscreen/offscreen.html/js`, `extension/content/content.js`, `extension/popup/popup.html/js`, `extension/sidepanel/index.html` (+ `index.js` updates), `extension/dashboard/index.html` (+ `index.js` updates), `bridge/index.js` + `bridge/package.json`, `server/index.js` + `server/package.json`, `playground/index.html` + `playground/package.json` (+ `playground/index.js` updates).

They now live only as **specs in this doc** — re-create them in your branch following the specs above + `docs/architecture.md` + `docs/tasks/*.md`.

## Build order reminder

See `docs/build-order.md` (10 steps, MVP re-cut). Kickoff order: 1 extension skeleton → 2 Tier0 → 3 offscreen 3 extractors → 4 Tier1+Tier2+redaction+self-audit → 5 pipeline integration → 6 playground+bridge **in parallel with** 7 Reasoning Server → 8 security demo → 9 Human Mode → 10 QA/pitch.
