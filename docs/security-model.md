# PerScope — Security Model (v3)

## Two Boundaries

```
[Webpage: DOM + screenshot]
  ↓ (on-device only)
[Perception + Tiered Detection + Qwen 2B → Sanitization Plan → Deterministic Redaction → Self-Audit]
 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ TRUST BOUNDARY: Sanitized Context ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
[PerScope Reasoning Server / Real MCP Agent / Playground / Paste-Target Chat] — reasoning over sanitized context only
  ↓ {id, tool, params}
[Validator: isDestructive()] — identical for all callers
  ↓
[content.js: live DOM execution]
```

## Guarantees

### 1. Redact-before-serialize (plan/execute split)

- Tier2 Qwen 2B **decides** (Sanitization Plan: spans → `[PERSON]`/`[EMAIL]` etc.) — internal, never transmitted, never trusted to rewrite.
- **Deterministic redactor executes**: DOM `value` replacement (structure/IDs/classes/roles untouched) + image bbox masking. Non-model step cannot hallucinate.

### 2. Never send/store raw screenshot

Sanitized Context is structured JSON (`elements: [{id, type, label, value:"[EMAIL]", bbox, ...}]`) + optional sanitized image/visual. Raw screenshot + raw DOM text never cross the boundary and are not persisted (Dashboard stores redacted-only entries with `Clear All`).

### 3. Uniform validator — same gate for every caller

`isDestructive({tool, params, element})` runs on **every** `click`/`type`/`submit`/`select_option` before `content.js` touches DOM. Same function for:

- PerScope Reasoning Server (our own model — no shortcut for "our model is trusted"),
- Real MCP agent (Claude Code/Codex via bridge),
- Playground,
- **Hidden prompt-injection text on the page itself** (validator evaluates what the *action* would do, not where the instruction came from).

Outcome for destructive: `{status:"blocked", reason, pending_id}` → side panel Approve/Deny (60s timeout → `timeout`) → `{type:"action_update", pending_id, status:"ok"|"denied"|"timeout"}`. Security Log records every blocked + confirm outcome. `scroll` and `read_page`/`list_interactive_elements` are never gated.

### 4. Fail-closed self-audit

After redaction, **re-run Tier0 + Tier1 on the output payload** (not input). If hit → block payload entirely, log, do not auto-retry. Low-confidence OCR matches never silently clear as safe — they escalate.

### 5. OCR confidence escalation (the v3 fix)

- **DOM-sourced** Tier0 match (checksum etc.) → trusted directly.
- **OCR-sourced** Tier0 match: trusted only if **high PaddleOCR confidence** *and* checksum passes; otherwise escalate to Tier1 (Ettin). Prevents low-signal OCR from silently passing PII as "safe."

### 6. Fail-closed vs. "clean" distinction

- `clean` = no sensitive info found (explicit).
- `blocked`/`ambiguous` = region could not be safely sanitized — capture does not proceed until reviewed. The UI must distinguish these; Dashboard must not conflate "0 redacted" with "0 found due to error."

## What the validator is NOT

- It does not try to detect prompt-injection language with an LLM. It is a local, deterministic check on the proposed *action* (e.g. `Delete Account` button, `submit` on a form that deletes data).
- It does not depend on the caller being honest about `element_id` — `content.js` re-resolves the id against current DOM and returns `stale_element` if mismatched.

## Permissions & Surface Area

- Manifest `tabs` + `scripting` required for Chat Destination & Injection Layer — disclosed, not silent.
- Offscreen document is the only WebGPU/ONNX host; `background.js` never touches pixels or token streams.

## Citations (corrected per Person 6)

- Offscreen + WebGPU pattern: **community-proven, publicly documented** (not "Hugging Face's own reference Gemma extension").
- Server model: **Qwen3** family (not Qwen2.5, which is dated as of 2026) — open-weight, Apache 2.0.
