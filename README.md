# PerScope — See everything. Leak nothing.

> **SIH26171 — On-device Visual Perception for Light-weight Browser Agents**
> Organization: ISRO / Department of Space · Category: Software · Theme: Smart Automation

> This document reflects the **Final Architecture Overview (Team Cosmic Crux)** and supersedes all earlier drafts (Moondream/SmolVLM, OpenRedaction-only, agent-only framing).

## Core Principle

> **We change content, not structure — structure, semantics, and relationships remain intact. Only sensitive values are replaced.**

Everything else in this document is a consequence of that one sentence.

## Overview

PerScope is a **local, zero-trust perception and redaction layer** that sits between any webpage and any AI — agent or human. It is not an agent and not a browser automation script. It is a **tool-server**, reachable four different ways, that guarantees nothing sensitive leaves the device unredacted and nothing destructive executes without passing a local validator — regardless of who or what is asking.

The local pipeline (perception → tiered detection → Qwen3.5-2B reasoning → deterministic redaction) decides what is sensitive and removes it — that is the only thing PerScope constrains. Once sanitized context crosses the trust boundary, the server-side agent (open-weight Qwen2.5-Instruct) reasons over it **completely freely**. When the server decides an action is needed (click, type, submit, scroll, etc.), it calls back into the extension to perform it — the extension is the only component with permission to touch the real DOM. The only check after the server decides is whether that specific action is destructive, evaluated locally.

### Four Consumption Modes

All four speak the identical `{id, tool, params}` schema into the identical local validator. The extension cannot tell them apart — that is the point.

| Mode | Who is calling | Status |
|---|---|---|
| **PerScope Reasoning Server** | Self-hosted open-weight LLM (Qwen2.5-Instruct 7B) operated by PerScope | **Required** — PS deliverable |
| **Real MCP Agent** | Claude Code / Codex via auto-launched, zero-logic MCP bridge | Bonus — proves protocol compatibility |
| **Demo Playground** | Manual simulated agent (same WebSocket schema) | Demo / observability console |
| **Manual query / Send to Chat** | The user directly, no agent — sanitized description to paste or auto-send into any chatbot | Differentiator — works with zero agent installed |

## Two Products, One Pipeline

One local pipeline, two front doors. Both terminate in the same sanitization pipeline and the same trust boundary.

| Product | How it works |
|---|---|
| **Human Mode** | Person, no agent installed, uses the extension directly to safely show a page to whatever AI chat they already have open. Primary surface most users will touch. |
| **Agent Mode** | Autonomous reasoning system (PerScope's own server or a real MCP agent) drives the extension programmatically via the tool schema. |

### Human Mode — Popup UI and Capture Flow

The popup's primary job is the **Capture** action.

**Popup, default state:**
- **Tab selector** — pick which open tab to capture (defaults to current tab).
- Single **Capture** button — not "Analyze/Scan/Redact".
- **"Privacy protected ✓"** trust indicator, always visible.

**On Capture — live progress** reusing the existing pipeline stages: page captured → text extracted → sensitive information detected → sanitizing, with persistent line *"Everything stays on this device."*

**Capture Review screen (required, before anything is sent):** PerScope shows exactly what would be transmitted.

- **Visual view** — screenshot-style representation with sensitive regions masked in place.
- **Context view** — structured, semantic representation of what will actually be sent (e.g. `User: [PERSON]`, `Email: [EMAIL]`, `Status: Active`) — placeholders preserve semantics per the core principle.

Outcome states (not always "success"):
- **Clean** — "No sensitive information detected" (distinct from "0 items redacted").
- **Ambiguous / low-confidence** — fail-closed; user reviews before continuing.
- **Blocked** — region could not be safely sanitized; capture does not proceed until reviewed.

Stats shown: count and type of items redacted.

**Send to Chat — two distinct actions:**
- **Send** — injects sanitized content into the destination chat's input box only. Safer default.
- **Send & Submit** — injects and submits in one step; requires explicit opt-in (same principle as destructive-action confirmation).

**Destination selection:** PerScope auto-detects open tabs that look like known AI chats (ChatGPT, Claude, Gemini, etc.) and offers the default target; user can pick any open tab manually. Injection executes through `content.js` — same DOM-execution boundary as every other action.

**Wrapped, not dumped raw:** sanitized content is inserted inside a short explanatory wrapper (e.g. *"I captured the following webpage through PerScope. It was processed locally and sensitive information was redacted before being sent. Please analyze the sanitized content below."*) so the destination AI understands placeholders like `[PERSON]`/`[EMAIL]`.

### Chat Destination & Injection Layer

First-class component alongside the extension components: owns tab discovery (finding candidate AI-chat tabs), per-site adapters (input-box selectors for ChatGPT/Claude/Gemini, etc.), and the Send / Send & Submit distinction. Executes through `content.js`; does not introduce a second way to touch the live page. See Architecture → Extension-Side Components below.

## Architecture

### End-to-End Flow

Every stage above the trust boundary runs 100% on-device. Only sanitized context crosses.

1. **Inputs** — DOM snapshot + screenshot from the active tab.
2. **Local Perception** — DOM Extractor (elements, attrs, ARIA, bboxes) + PaddleOCR (text, bboxes, confidence) + Florence-2-base (captions, region grounding) produce a unified text-and-layout representation.
3. **Tiered PII Detection —** Tier 0 regex + checksum (auto-redacts high-confidence hits; OCR-sourced low-confidence or failed-checksum → escalates, never cleared) → Tier 1 Ettin-68M NER (runs only on residual text; output is candidates, NOT auto-redacted) → Tier 2 Qwen3.5-2B local (`Qwen/Qwen3.5-2B`, Apache 2.0 — adjudicates candidates using context, invoked only when ambiguous).
4. **Sanitization Plan** — internal-only mapping of spans to replacement values; never transmitted.
5. **Deterministic Redaction** — DOM redaction (values only) + image redaction (mask/blur via bbox, powered by Open Redaction Library patterns), non-model, structure 100% intact.
6. **Self-Audit** — re-runs Tier 0 + Tier 1 on the *output* payload; fail-closed (block + log) if anything remains.
7. **Sanitized Context crosses the trust boundary** — Sanitized DOM + optional Sanitized Image / Sanitized Visual Representation.
8. **Server Reasoning** — Qwen2.5-Instruct (open-weight, self-hosted via vLLM/Ollama; same family as on-device Qwen3.5-2B), cloud-hosted only for SIH demo latency. Constrained to tool schema (`read_page`, `list_interactive_elements`, `click`, `type`, `submit`, `select_option`, `scroll`) via structured/function-calling output; multi-turn (can return action or request for more evidence like `scroll`).
9. **Action Validator** — `isDestructive()` check gates every proposed action; same gate regardless of source (server, MCP agent, Playground, or hidden prompt-injection text on the page). This is the entire prompt-injection defense.
10. **Local execution** — validated actions executed locally by `content.js` on the real DOM.
11. **Continuous Action Loop** — perception → reasoning → validation → execution repeats until the task completes.

> **Methodology (PDF § Technical Approach):** 1 Capture Evidence (DOM+OCR+Vision) → 2 Detect PII (NER flags emails/phones/names/addresses) → 3 Reason Locally (on-device LLM decides sensitivity) → 4 Redact & Verify (values masked, structure kept, self-audited) → 5 Send Sanitized Data (only cleaned context crosses trust boundary) → 6 Act on the Page (local agent executes safely, results loop back).

```
Trust boundary:  Sanitized Context  ===  Server LLM/VLM
Everything above === runs on-device; raw DOM/screenshot/PII never cross.
```

### Tiered Detection — Pyramid, Not Flat Pipeline

Detection escalates only as far as needed. Most PII resolves at the base, near-zero cost; the heaviest model runs only for genuinely ambiguous cases and can be skipped entirely on a clean page.

```
L1 · Local Perception         — DOM Extractor + PaddleOCR + Florence-2-base — runs on every page
L2 · Tiered PII Detection     — Regex/Checksum first, Ettin-68M NER only on what's left
L3 · Local Reasoning          — Qwen3.5-2B judges ambiguous cases only
L4 · Deterministic Redaction  — executes the plan, structure stays intact
 ─ ─ ─ ─ ─ ─ TRUST BOUNDARY ─ ─ ─ ─ ─ ─
L5 · Server Reasoning         — open-weight Qwen2.5-Instruct, sanitized input only
L6 · Execution & Validation   — every action validated before it runs  →  loops to L1
```

Why Ettin flags are not auto-redacted: NER gives entity type, not sensitivity. Tier 1 output is a candidate list; only Qwen3.5-2B's context-adjudicated Sanitization Plan is executed, and only by the deterministic redactor — the model never gets the chance to hallucinate a redaction.

Why regex is not DOM-only: it runs on DOM values (checksum trusted directly) *and* OCR text (checksum trusted only at high OCR confidence).

### Extension-Side Components

| Component | Responsibility |
|---|---|
| `background.js` | WebSocket client (outbound only), 20s keepalive, message routing by `id`/`type`, action validator (`isDestructive()`), pending-action map for confirm flow |
| `offscreen.js` | Hosts all on-device models (DOM/OCR/vision perception, Tier 0–2 detection, Qwen3.5-2B reasoning) via Transformers.js + ONNX Runtime Web, WebGPU with WASM fallback |
| `content.js` | Only component with live DOM access — captures state, executes validated actions (`click`/`type`/`submit`/`select_option`/`scroll`), reports back |
| Side panel | Live view during active tool-call sequence: bounding boxes, redaction happening, Approve/Deny prompt for blocked actions. Power-user inspection surface, one level below Dashboard history |
| Dashboard | Privacy Log (every redaction: detected item, confidence, exact payload sent, per capture — source tab, count/type, destination) + Security Log (every blocked/flagged action + confirm-flow outcome), redacted-only storage, Clear All button |
| Popup | Primary human-facing surface — tab selector + Capture button, live progress, Capture Review (Visual + Context views, states: clean/ambiguous/blocked), Send / Send & Submit |
| Chat Destination & Injection Layer | Discovers candidate AI-chat tabs, holds per-site adapters for locating a chat's input box, executes injection/submission through `content.js` |

Manifest requirement: `minimum_chrome_version: 116` — required for WebSocket-in-service-worker keepalive. **Chrome-only**; no Firefox claim without actual testing (offscreen-document and WebGPU support differ).

### Action Validation & Confirm Flow

```
Caller (Server / Agent / Playground) -> {id, tool: "click", params} -> background.js -> isDestructive()
  ├─ not destructive → content.js executes → {id, status: "ok"}
  └─ destructive → {id, status:"blocked", reason, pending_id} + side panel Approve/Deny
       ├─ approve → content.js executes → {type:"action_update", pending_id, status:"ok"}
       ├─ deny    → {type:"action_update", pending_id, status:"denied"}
       └─ 60s timeout → {type:"action_update", pending_id, status:"timeout"}
  Security Log records blocked / pending confirm.
```

Same check runs whether the click was requested by the legitimate caller or surfaced from hidden white-on-white text on the page — validator evaluates what the action would do, not where the instruction came from.

### Server-Side Reasoning — Requirement, Not Demo Convenience

PS requires transmitting sanitized context to a centralized LLM/VLM and receiving actionable commands back using an open-source/open-weight model. Cloud-hosting is permitted only as hosting convenience.

- **Model:** Qwen2.5-Instruct (server), same family as on-device Qwen3.5-2B (`Qwen/Qwen3.5-2B`, Apache 2.0).
- **Offline path:** self-hosted via vLLM or Ollama — fully offline, self-hostable; cloud GPUs rented only for demo latency.
- **During SIH:** same open weights on rented GPU for demo latency — stated explicitly, not required in production.
- Validator applies identically to PerScope's own server — system defends against its own model proposing a bad action.

## Tech Stack

| Layer | Technology |
|---|---|
| Extension shell | WebExtensions (Manifest V3), Chrome 116+ (Chrome-only) — JS (ES6+) |
| Perception | DOM Extractor (native), PaddleOCR, Florence-2-base |
| Fast-path detection | Regex + checksum validation (Luhn, format patterns) — Open Redaction Library (`sam247/openredaction`) |
| PII candidate detection | Ettin-68M NER (`kalyan-ks/ettin-68m-nemotron-pii`, 55 entity types, edge-optimized) |
| Local reasoning / adjudication | Qwen3.5-2B (`Qwen/Qwen3.5-2B`, Apache 2.0 — adjudicates ambiguous cases only) |
| Redaction execution | Deterministic (non-model) DOM + image redactor (mask/blur via bbox) |
| On-device runtime | Transformers.js, ONNX Runtime Web, WebGPU, WASM (fallback) |
| Transport | WebSocket (`background.js` keepalive — 20s), MCP Bridge (stdio ⇄ WebSocket, zero logic) |
| Server-side reasoning | Qwen2.5-Instruct, vLLM / Ollama (self-hosted, open-weight) |
| Real-agent compatibility | Model Context Protocol (`@modelcontextprotocol/sdk`) — `modelcontextprotocol.io/specification/2025-06-18/architecture` |

## Feasibility Snapshot (per PDF)

- **Technical:** Transformers.js + ONNX Runtime Web + WebGPU/WASM run PaddleOCR, Florence-2, Ettin-68M and Qwen3.5-2B inside a standard Chrome extension.
- **Economical:** Open-weight Qwen models remove licensing cost; on-device inference cuts server compute.
- **Social:** PII stays on-device; Send to Chat works with zero agent installed.
- **Legal:** Raw DOM/screenshots/PII never leave device; offline self-hosted deployment satisfies data-sovereignty.
- **Operational:** Manifest V3 install; side panel + dashboard Privacy/Security Logs + Approve/Deny confirm flow.
- **Security:** Fail-closed self-audit + uniform `isDestructive()` validator (hostile pages and model mistakes).

## Research and References

- Transformers.js Chrome Extension — `huggingface.co/blog/transformersjs-chrome-extension` — offscreen documents + WebGPU pattern.
- PaddleOCR.js — `github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.en.md` — ONNX Runtime + WASM/WebGPU in-browser OCR.
- Ettin-68M-Nemotron-PII — `huggingface.co/kalyan-ks/ettin-68m-nemotron-pii` — 55 entity types, edge-optimized.
- safeclipper — `github.com/AFK-surf/safeclipper` — local OCR + bbox image redaction.
- PrivacyLens — `github.com/shitijkarsolia/privacylens` — PII redaction with pre-send review.
- MCP — `modelcontextprotocol.io/specification/2025-06-18/architecture` + `openredaction` — `github.com/sam247/openredaction`.
- On-device model: Qwen3.5-2B — `huggingface.co/Qwen/Qwen3.5-2B` (Apache 2.0).

## Repository Structure

```
/extension
  /background        # background.js — owned by: Extension/Automation
  /offscreen          # offscreen.js — owned by: Perception + Privacy/Redaction
  /content             # content.js — owned by: Extension/Automation
  /sidepanel
  /dashboard
  /popup               # Capture flow — owned by: Extension/Automation
  manifest.json
/server                # PerScope Reasoning Server — owned by: Server/Bridge/Playground
/bridge                # MCP stdio<->WebSocket bridge — owned by: Server/Bridge/Playground
/playground             # Demo WebSocket client/UI — owned by: Server/Bridge/Playground
/docs
  architecture.md      # do not generate content — placeholder only
  tool-schema.md        # do not generate content — placeholder only
README.md
LICENSE
.gitignore
```

## Team

**Cosmic Crux — SIH26171**

Component ownership by area:

| Area | Ownership |
|---|---|
| Extension / Automation | Extension/Automation |
| Perception | Perception |
| Privacy / Redaction | Privacy/Redaction |
| Server / Bridge / Playground | Server/Bridge/Playground |
| Research / QA | Research/QA |

> Member names and detailed task breakdowns are tracked under `/docs/tasks/<role>.md` (added separately per owner).

## Status

This is a research-grounded architecture at prototype-build stage. This README is the consolidated reference and supersedes earlier drafts. For full detail see:

- [`/docs/architecture.md`](/docs/architecture.md)
- [`/docs/tool-schema.md`](/docs/tool-schema.md)

These files already exist / will be added separately — their content is not generated here.

## License

MIT — see [LICENSE](LICENSE).
