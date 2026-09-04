# PerScope — Changelog

> **How to log while testing/reshaping:** add a new entry at the top (newest first) using the template below. Commit to `main` — Vercel redeploys `docs/` automatically. This file is the team's single running record judges can follow.

## Template — copy for new entry

```markdown
## YYYY-MM-DD — Area — Author

- **Change:** what changed (e.g. "Tier0 now escalates low-confidence OCR matches instead of clearing").
- **Why:** reason / test failure that triggered it.
- **Impact:** which docs/code updated (e.g. `docs/security-model.md`, `piidetector.js`, `v3.mjs`).
- **Follow-up:** open gap or next test.
```

---

## 2026-09-04 — Architecture v3 — Cosmic Crux

- **Change:** Locked architecture v3 published — perception is 3 parallel extractors (DOM+PaddleOCR+Florence-2), redaction is 3-tier (regex→Ettin-68M→Qwen2B→deterministic→self-audit), Reasoning Server (Qwen3 via vLLM/Ollama) is required not optional. Added `select_option` + `scroll` to tool schema (7 tools).
- **Why:** Task List v3 (SIH26171) updated scope — single VLM and regex-only no longer satisfy PS.
- **Impact:** `docs/architecture.md`, `docs/tool-schema.md`, `docs/build-order.md`, `docs/security-model.md`, `docs/tasks/*`.
- **Follow-up:** Firefox + face decisions still open — see `docs/limitations.md`.

## 2026-09-04 — Qwen Adjudication — Local pipeline

- **Change:** Implemented Qwen3.5-2B final adjudication in `v3.mjs` + `qwen_redaction_pure.mjs`: reading-order, deterministic label/value rules, fusion containment (`ABC123XY98` > `98`), Qwen strict JSON, safety gates, fail-closed, Sharp only on final findings.
- **Why:** Ettin alone produced partial/duplicate candidates; OCR noise needed multimodal adjudication.
- **Impact:** `qwen_redaction_pure.mjs`, `v3.mjs`, `tests/qwen_regression.test.mjs` (15 tests).
- **Follow-up:** Bench memory with 4 models in offscreen document.

## 2026-09-04 — Docs Site — Deployable

- **Change:** Made `docs/` a Vercel-deployable Next.js team site (`docs/package.json`, `app/`, `vercel.json`, `tailwind.config.js`). Browse all docs + tasks + changelog at one URL.
- **Why:** Need shareable link for judges to follow live architecture reshaping.
- **Impact:** `docs/app/*`, `docs/lib/docs.ts`, `docs/CHANGELOG.md`.
- **Follow-up:** Set Vercel project root to `docs`, deploy.

---

## 2026-09-XX — YOUR ENTRY

- **Change:**
- **Why:**
- **Impact:**
- **Follow-up:**
