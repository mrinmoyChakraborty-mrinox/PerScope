# PerScope — Honest Limitations (v3)

State these plainly on stage — they are known, tracked, not hidden.

## Required but not yet fully addressed

### Face redaction — GAP, not silently omitted
PS explicitly names "blurring faces" as an expected redaction type. Current pipeline (Perception: DOM+OCR+Florence, Redaction: text/PII) does **no face detection**.

- **Decision needed (Person 3 + Person 2):** add lightweight local face model (e.g. BlazeFace/MediaPipe, ~5 MB, WASM) in perception + bbox masking in deterministic redactor, **or** name as **known limitation this cycle** — do not leave unaddressed. This doc records the gap.

### Firefox — architecture-compatible, not validated
PS says "popular browsers (chrome, Firefox)". v3 manifest is Chrome-first (`minimum_chrome_version: 116` for service-worker WebSocket). Architecture *is* Firefox-compatible (MV3 + `browser.offscreen` where available, `browser_specific_settings`), but **not yet tested** on actual Firefox (offscreen/WebGPU differ). Stage line: **Chrome-first, Firefox-compatible architecture**.

## Model & Runtime limits

### Florence-2-base — experimental ONNX/browser support
Publicly documented as **experimental** for Transformers.js + ONNX Runtime Web. Real behavior: occasional CAPTCHA-style dense-page misses, region-grounding drift. **Fallback:** degrade to **DOM Extractor + PaddleOCR only** — still satisfies PS multi-signal ask. Person 2 profiles WebGPU→WASM failover per-model; Person 6 tests both independently.

### PaddleOCR — low-confidence text
CJK/messy handwriting at low confidence escalates instead of trusting checksum — correct behavior, but costs latency (Tier1). Mitigation: Tier0's confidence gate + Tier1+Tier2 only on ambiguous.

### Ettin-68M NER (55 types) — linguistic limits
Hyphenated / accented names (`María-José`), rare scripts, non-Latin PII may under-flag or over-flag. Mitigation: candidate-not-auto-redact design + Qwen 2B context, plus conservative fallback ("escalate all Tier1 candidates") if Qwen 2B not landed.

### Qwen 2B local adjudication — memory/latency
Four models in one offscreen document (PaddleOCR + Florence-2 + Ettin + Qwen 2B) is heavier than v2's single VLM. **Must profile early** (Person 2 + Person 3 shared ownership discussion). Fallback: skip Tier2 and treat all Tier1 candidates conservatively.

## System limits

### Small models on dense pages
Dense dashboards/ISRO ground-station consoles with 100+ elements: extractor bbox alignment and scroll-then-re-evaluate (`scroll` tool) are needed. `read_page` gives `page_height` for scroll math.

### MCP confirm-flow gap — real protocol gap
MCP `tools/call` is request/response only — **cannot carry unsolicited `action_update` push**. Current bridge returns `{status:"blocked", pending_id}` and stops. Agent has **no way** to learn later `approved`/`denied`/`timeout`. **Must decide before finals** (Person 1 + Person 5): add polling tool `check_pending_action` or hold MCP response open if transport allows. Tracked in `tool-schema.md` § How a blocked result surfaces.

### Server GPU — SIH demo latency
Qwen3 server can run on **rented GPU** for SIH only — PS permits this, but stage must state it plainly (not imply laptop). Offline self-hosted path via vLLM/Ollama exists and is the real deliverable.

### Redaction precision is 20% of SIH scoring
Because of the above, demo must rehearse the broadened use case (ISRO-regulated / sensitive-screen) and competitive line (vs. Nanobrowser: we change content not structure, fail-closed, validator treats all callers identically).

## What we will NOT claim

- Firefox fully tested (until it is).
- Face blurring done (until face model lands).
- Florence-2 fully stable in-browser.
- Tier2 Qwen 2B always required (it is degradable).
