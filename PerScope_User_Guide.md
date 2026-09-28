# PerScope — Privacy-Preserving Browser Agent

## User Guide + Judge Demo Guide

> **Status note:** PerScope Architecture v4 marks Sections 1–3 as tested ground truth and Sections 4–6 as planned design. This guide keeps that distinction explicit.

## What is PerScope?
PerScope is a privacy-preserving browser-agent architecture for understanding browser screens locally, detecting sensitive information, sanitizing it, and producing evidence that can be reviewed before future agent action or external reasoning.

The currently tested flow is image-based (file upload or visible-tab capture). The tested models run locally with WebGPU and WASM/CPU fallback; the tested build makes no cloud calls.

## Why use it?
- Protect screenshots before sharing them.
- Keep sensitive values local while preserving useful page context.
- Review what was detected and why.
- Prefer safe failure over blind trust when visual-model proposals are invalid.

## Quick Start
1. Install the Chrome extension. Minimum documented Chrome version: 116.
2. Open the extension popup.
3. Upload an image or capture the visible tab.
4. Wait for the local pipeline to finish.
5. Review the redacted image and evidence.
6. Use the sanitized result for sharing or later AI integration.

> The Architecture v4 file does not define the final release package or exact dependency-install commands. The public docs should copy those commands from the repository root README rather than invent them.

## How it works
1. Input image — file upload or visible-tab capture.
2. Face detection — BlazeFace / ONNX.
3. OCR — PaddleOCR PP-OCRv6-small.
4. PII signals — Ettin-68M NER + deterministic heuristics.
5. Visual adjudication — FastVLM-0.5B.
6. Fusion — merge candidates, types, sources, confidence, OCR references.
7. Safety gates — FastVLM proposals must reference real fused candidates and allowed types.
8. Value-only geometry — exact match, proportional sub-box, otherwise reject.
9. Canvas redaction — blur or black-box sensitive values only.
10. Caption scrubbing — replace sensitive values with `[REDACTED:TYPE]`.
11. Output — redacted image + evidence object.

## Privacy & Safety
- All tested models run on-device with WebGPU and WASM/CPU fallback.
- The tested flow makes no cloud calls.
- Redaction is value-only, preserving surrounding layout.
- FastVLM is not treated as the final authority.
- Invalid model proposals trigger `fusion_fallback`.

## Judge Demo (60–90 seconds)
1. Show a realistic screenshot containing a few sensitive fields.
2. Capture the visible tab or load the image.
3. Show perception + OCR + NER/heuristics + FastVLM + fusion + safety gate.
4. Show value-only redaction.
5. Show the evidence object.
6. Explain the trust boundary and the fact that the tested flow remains local.
7. Clearly label action execution and server reasoning as planned unless they are accepted as built.

## Extension components
- `background.js` — capture/lifecycle/bridge relays.
- `offscreen.js` — on-device models and bridge routing.
- `content.js` — DOM snapshot capture + opaque refs; action execution pending.
- Popup — upload/capture/progress/bridge status.
- Dashboard — telemetry/evidence/export.

## Current limitations
- FastVLM-0.5B may produce bland captions or occasional JSON-schema misses.
- Heuristics can over-redact at edges.
- WASM fallback is slower.
- Action execution, reasoning server, Send-to-Chat, and per-site adapters are not built in the tested scope.
- Firefox is not validated.
- Output-level self-audit is not re-implemented; caption scrubbing is the tested equivalent.

## FAQ
**Does PerScope send screenshots to a cloud model?** Not in the current tested flow.

**Does it modify the original webpage?** The tested capture path does not mutate the DOM; image redaction operates on captured/uploaded images.

**What if FastVLM is wrong?** Safety gates validate its proposals; invalid proposals fall back to deterministic fused signals.

**Can it already click/submit browser actions?** Not in the tested v4 scope; action validation/confirmation is planned.

**Can judges inspect detection results?** Yes; the output includes findings, bounding boxes, captions, timings, and device information.

## References
- Transformers.js Chrome Extension — https://huggingface.co/blog/transformersjs-chrome-extension
- PaddleOCR — https://github.com/PaddlePaddle/PaddleOCR
- Ettin-68M-Nemotron-PII ONNX — https://huggingface.co/rulesentry-io/ettin-68m-nemotron-pii-onnx
- BlazeFace ONNX — https://huggingface.co/garavv/blazeface-onnx
- FastVLM-0.5B ONNX — https://huggingface.co/onnx-community/FastVLM-0.5B-ONNX
- OpenRedaction — https://github.com/sam247/openredaction
- MCP Architecture — https://modelcontextprotocol.io/specification/2025-06-18/architecture

## PPT judge link
Recommended label: **OPEN THE PER-SCOPE USER GUIDE**

For the final PPT, publish this Markdown as a public GitHub Pages/Docs page and use the public URL or a QR code.
