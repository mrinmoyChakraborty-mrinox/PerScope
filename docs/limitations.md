# PerScope — Honest Limitations (prototype + locked next phase)

> Tested prototype limits mirror root README §6; planned-work deferrals mirror README §7.6. State these plainly on stage — they are known, tracked, not hidden.

## Tested prototype (image pipeline)

- **FastVLM-0.5B is small:** captions/adjudication can be bland or miss JSON schema; pipeline survives via validation → `fusion_fallback` → still redacts via OCR/NER/heuristics, but richness is bounded by model capacity.
- **Heuristics can over-redact at edges** (e.g. number row inheriting nearby label context) — safe-direction tradeoff; fusion/validators narrow it where possible.
- **WASM fallback is single-threaded by necessity** (int64 inputs crash the threaded WASM build); CPU inference of the big models is slow — demo on WebGPU-capable hardware.
- **`tests/run-checks.mjs` still references a legacy `models/FastVLM-0.5B-ONNX` check path;** the real full-offline path is `models/onnx-community/FastVLM-0.5B-ONNX`.

## Explicitly deferred (locked plan, README §7.6)

- DOM overlay visual masking (Phase 2) — stretch goal, scoped demo pages only.
- Native Messaging for extension↔bridge — WebSocket ships first; Native Messaging is a post-MVP hardening item.
- Multimodal adjudication for DOM mode — toggle (`FASTVLM_FOR_DOM`), off by default.
- Output-level self-audit re-scan vs. relying on caption scrubbing alone — still open.

## System limits (still true)

### Small models on dense pages
Dense dashboards/ISRO ground-station consoles with 100+ elements: extractor bbox alignment and scroll-then-re-evaluate (`scroll` tool) are needed. `read_page` gives `page_height` for scroll math.

### MCP confirm-flow — RESOLVED via blocking call
Supersedes the old `action_update`-push gap: flagged actions hold the MCP `tools/call` open until approved/denied/60s-timeout. See `tool-schema.md` § How a blocked result surfaces and README §7.2.

### Server GPU — SIH demo latency
Cloud backend (same open-weight model, Together.ai / Fireworks / rented GPU running identical vLLM/Ollama setup) is permitted for SIH as a hosting convenience — stage must state it plainly (not imply laptop). Local path via Ollama/vLLM is the real deliverable.

### Redaction precision is 20% of SIH scoring
Demo must rehearse the broadened use case (ISRO-regulated / sensitive-screen) and competitive line (vs. Nanobrowser: we change content not structure, fail-closed, validator treats all callers identically).

## What we will NOT claim

- Firefox fully tested (until it is) — Chrome-only, no Firefox claim without testing.
- Bridge / DOM redaction / Playground built (until each subsection lands — see README §7 status lines).
- FastVLM-0.5B always produces valid JSON (it doesn't — fusion fallback covers it).
- DOM overlay masking in Phase 1 (text-level only by design).
