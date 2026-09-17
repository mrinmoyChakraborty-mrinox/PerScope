# PerScope — Security Model (v4, Tested + Planned)

> Tested guarantees (gates, fallback, caption scrubbing) are implemented. Validator / confirm-flow / logging guarantees are locked design, not yet built — marked per row.

## Two Boundaries

```
[Input image: screenshot / upload]
  ↓ (on-device only)
[BlazeFace + PaddleOCR + Ettin-68M + heuristics + FastVLM-0.5B → Fusion → Safety Gates → Value-Only Geometry → Canvas Redaction → Caption Scrubbing]  TESTED
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ TRUST BOUNDARY: Sanitized Context (intended, not yet wired) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
[Reasoning Server / Real MCP Agent / Playground / Paste-Target Chat] — reasoning over sanitized context only  PLANNED
  ↓ {id, tool, params}
[Validator: isDestructive()] — identical for all callers  PLANNED
  ↓
[content.js: live DOM execution]  PLANNED
```

## Guarantees

### 1. Never trust model output blindly (TESTED — plan/propose split)

- FastVLM-0.5B **proposes** (`redactions`, `additional_redactions`, `rejected_candidates`) — never executes.
- **Safety gates validate**: every proposal must reference a real fused `candidate_id` / OCR id and pass type allowlists.
- Failure → **`fusion_fallback`**: deterministic (heuristics + NER) output only. Distinguishes `ok` from `adjudication_failed`/`qwen_failed`-class states — a gate failure never presents as "clean".
- **Value-only geometry chokepoint**: exact match → full OCR box; substring → proportional sub-box with whole-line guards; otherwise **REJECT** rather than over-redact.

### 2. Caption scrubbing — second safety layer (TESTED)

Every known sensitive value is replaced with `[REDACTED:TYPE]` in any generated caption/description **before** it reaches UI or the evidence object. Covers a related but not identical failure mode to output re-scan.

### 3. Output-level self-audit (OPEN DECISION — see root README §7.6)

v3 self-audit (re-run Tier0+Tier1 on the *output* payload, fail-closed) has **not** been re-implemented on the fusion pipeline. Decide explicitly whether caption scrubbing suffices or output re-scan returns. Do not leave silent. Deferred items also tracked in README §7.6 (DOM overlay Phase 2, Native Messaging hardening, `FASTVLM_FOR_DOM` opt-in).

### 4. Never send/store raw image (TESTED locally; boundary wiring PLANNED)

Evidence object holds findings, bboxes, scrubbed caption, timings, device info. Dashboard stores redacted-only entries with PNG/JSON export + (planned) `Clear All`. Nothing in the tested build transmits anything to any server.

### 5. Uniform validator — same gate for every caller (PLANNED, locked in root README §7.2)

`isDestructive({tool, params, element})` lives in the **extension**, immediately in front of `content.js`, and runs on **every** `click`/`type`/`submit`/`select_option` before DOM is touched. The bridge is zero-logic and cannot bypass it. Same function whether the caller is a real MCP agent, the Playground Local/Manual/Cloud backend, or **hidden prompt-injection text on the page** (evaluates what the *action* would do, not where the instruction came from). Confirm flow is a **blocking tool call**: destructive → side-panel Approve/Deny holds the call open → `ok` / `denied` / `timeout` (60s). `scroll` / `read_page` / `capture_tab` / `list_interactive_elements` never gated. `content.js` re-resolves `element_id` against live DOM (`stale_element` on mismatch).

Extension ↔ Bridge transport is `ws://127.0.0.1:<port>`, origin-checked, with a one-time shared-secret pairing (code shown in bridge dashboard, entered once in extension options; all further messages signed/checked).

### 6. Clean vs. ambiguous vs. blocked (TESTED in pipeline, PLANNED in UI)

- `clean` = no sensitive info found (explicit).
- `ambiguous`/low-confidence = fail-closed, user reviews before continuing.
- `blocked` = region could not be safely sanitized — capture does not proceed until reviewed.
- UI + Dashboard must not conflate "0 redacted" with "0 found due to error".

## What the validator is NOT (planned)

- Not an LLM prompt-injection detector — a local, deterministic check on the proposed *action*.
- Not dependent on caller honesty about `element_id`.

## Permissions & Surface Area

- Manifest `tabs` + `scripting` required for the (planned) Chat Destination & Injection Layer — disclosed, not silent.
- Offscreen document is the only WebGPU/ONNX host; `background.js` never touches pixels or token streams.
- Tested MV3 manifest loads ORT WASM from `chrome.runtime.getURL("ort/")`, not CDN (MV3 CSP).

## Citations

- Offscreen + WebGPU pattern: **community-proven, publicly documented** (not an official vendor reference extension).
- Server model: **TBD, explicitly not Qwen** — open-weight, Apache-2.0-compatible or equivalent, via vLLM/Ollama.
