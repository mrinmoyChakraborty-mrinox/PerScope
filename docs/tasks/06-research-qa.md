# Person 6 — Research, QA & Pitch Lead (Adreeja)

## Citations — corrections required

1. **Offscreen+WebGPU pattern:** Do **not** cite "Hugging Face's own reference Gemma extension" — pattern is **community-proven, publicly documented** (e.g. community Chrome extensions + `huggingface.co/blog/transformersjs-chrome-extension` as general reference, not official Gemma reference). Use that phrasing.

2. **Server model:** Cite **Qwen3**, not Qwen2.5 — 2.5 is dated as of 2026. Server is `Qwen/Qwen3-*` via vLLM/Ollama (open-weight, Apache 2.0); on-device adjudication is Qwen3.5-2B.

## Deck Structure (unchanged shape)

Problem → Architecture (three callers, three extractors, three tiers) → Two-boundary security model (plan/execute split) → Demo (three callers, same validator) → **Honest limitations**.

## Answers to know cold (rehearsed with owner)

- **Redact-before-serialize guarantee** — from Person 3: now **plan (Tier2 Qwen 2B) → execute (deterministic redactor)** split, not single-pass. Sanitization Plan is internal, never transmitted; deterministic step cannot hallucinate.
- **How validator stops prompt injection** — from Person 4: uniform `isDestructive()` on every `click`/`type`/`submit`/`select_option`, regardless of which of the three callers issued it **or** hidden text on page; staged demo with white-on-white instruction targeting Delete Account.
- **How real agent connects** — from Person 5+1: `MCP stdio` → auto-spawned bridge (`stdio ⇄ WebSocket`) → `background.js`; `tools/list`/`tools/call` ↔ WebSocket.
- **Why Qwen3 / why server required** — PS **explicitly requires** open-weight, offline-deployable server reasoning; cloud GPUs during SIH are **permitted convenience for latency**, not license to use closed API. Honest answer tracked here.
- **Face redaction** — from whoever owns it (Person 3 per `03-privacy-redaction.md` gap): either "BlazeFace/MediaPipe WASM + bbox masking" or "known limitation this cycle — see `limitations.md`". Do not leave silent.

## New prep

- **Broadened use case — rehearse:** regulated / sensitive-screen (ISRO ground-station consoles, internal dashboards), not only "safely paste into ChatGPT."
- **Honest-limitations slide:** small models on dense pages, NER hyphenated/accented names, **plus** face gap, Firefox not validated, Florence experimental, Qwen 2B memory/latency.
- **Dated citations purged:** Qwen2.5 removed everywhere; Gemma attribution corrected.

## QA & Recording

- Test **WebGPU vs WASM independently** — now across **four** models (PaddleOCR, Florence-2, Ettin, Qwen 2B), not one.
- Record **full backup video**, including — if time allows — **one destructive-action block triggered by Reasoning Server specifically** (not just Playground/bridge) to make "same validator, any source" visibly true.
- Competitive research: **Nanobrowser contrast** — differentiator line (we change content not structure, fail-closed, validator treats all callers identically) — unchanged.

## Files

- Deck: `docs/pitch/` (or `docs/deck.md`)
- QA checklists: `docs/qa/`
- Limitations slide sources: `docs/limitations.md`, `docs/architecture.md`, `docs/build-order.md`

## Competitive & Honest Framing

See `limitations.md` for the full list to quote on stage. Do not overclaim Firefox/face/Florence stability.
