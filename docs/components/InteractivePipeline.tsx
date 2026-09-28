"use client";

import { useState } from "react";

interface PipelineStage {
  id: number;
  name: string;
  tag: string;
  shortDesc: string;
  input: string;
  output: string;
  technology: string;
  executionProvider: string;
  whyItExists: string;
  failureBehavior: string;
  sourceFiles: string[];
  icon: string;
}

const STAGES: PipelineStage[] = [
  {
    id: 1,
    name: "Input & Capture",
    tag: "INGESTION",
    icon: "📸",
    shortDesc: "High-resolution browser viewport or uploaded image ingested into memory buffer.",
    input: "Visible Chrome Tab (`chrome.tabs.captureVisibleTab`) or User drag-and-drop / file upload / clipboard paste.",
    output: "Raw RGBA Canvas pixels / Uint8Array byte buffer transferred to offscreen worker.",
    technology: "Chrome MV3 offscreen document API + HTML5 Canvas.",
    executionProvider: "Browser Native Execution",
    whyItExists: "Isolates memory ingestion away from untrusted web content and keeps heavy pixel processing off the main UI thread.",
    failureBehavior: "Fails closed if permissions are missing or image is corrupt; returns descriptive error.",
    sourceFiles: [
      "extension/v7 beta/src/popup/popup.js",
      "extension/v7 beta/src/offscreen/offscreen.js",
      "extension/v7 beta/src/background/service-worker.js"
    ]
  },
  {
    id: 2,
    name: "Face Detection",
    tag: "BIOMETRIC PRIVACY",
    icon: "👤",
    shortDesc: "Local neural network identifies human faces and profile pictures to protect biometric identity.",
    input: "Downscaled 128×128 NCHW image tensor.",
    output: "Array of face bounding boxes [ymin, xmin, ymax, xmax] with confidence scores.",
    technology: "BlazeFace ONNX (128×128 input, NMS IoU threshold 0.3, confidence ≥ 0.6).",
    executionProvider: "WASM / WebGPU optional",
    whyItExists: "Profile avatars, video thumbnails, and user portraits reveal personal identity even if text is scrubbed.",
    failureBehavior: "Silently skips face redaction if disabled in settings or model load error occurs, without crashing the text pipeline.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/face.js",
      "extension/v7 beta/models/blazeface/blaze.onnx"
    ]
  },
  {
    id: 3,
    name: "PaddleOCR Text Extraction",
    tag: "PERCEPTION",
    icon: "🔍",
    shortDesc: "High-precision on-device text and box localization across entire screen.",
    input: "Normalized RGB Canvas image slices.",
    output: "Structured OCR tokens: `Array<{ id: number, text: string, bbox: [ymin, xmin, ymax, xmax], confidence: number }>`.",
    technology: "PaddleOCR PP-OCRv6-small compiled for browser execution.",
    executionProvider: "WASM SIMD (Session singleton cached in offscreen document)",
    whyItExists: "Provides geometric anchors for all visual text on the page without depending on DOM availability (works on canvases, PDFs, images).",
    failureBehavior: "Fail-closed: if OCR fails to detect text tokens, downstream NER cannot bind, preventing false safety assumptions.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/v7-extension.js",
      "extension/v7 beta/models/paddleocr/"
    ]
  },
  {
    id: 4,
    name: "PII Signals & Heuristics",
    tag: "HYBRID DETECTION",
    icon: "🏷️",
    shortDesc: "Dual-track detection: Ettin-68M token classifier + deterministic regex & checksum validators.",
    input: "OCR text sequences + global spans.",
    output: "Entity candidates: Names, Credit Cards, SSN, Phone, Email, IP, IBAN, API Keys with source tags.",
    technology: "Ettin-68M Nemotron PII ONNX + Luhn / IBAN / IPv4 regex validators.",
    executionProvider: "WebGPU (pinned) with single-threaded WASM fallback (`intra/interOp:1`)",
    whyItExists: "Pure regex misses context ('John' vs 'Invoice'); pure ML misses formatted numbers (credit cards). Combining them gives 99%+ recall.",
    failureBehavior: "If WebGPU fails or int64 crash risk occurs, safely falls back to single-threaded WASM. Deterministic regex runs regardless.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/v7-extension.js",
      "extension/v7 beta/src/pipeline/ner-utils.js",
      "piidetector.js"
    ]
  },
  {
    id: 5,
    name: "FastVLM Visual Adjudication",
    tag: "VISION-LANGUAGE",
    icon: "🧠",
    shortDesc: "Visual-language model reviews the visual context to confirm semantic sensitivity.",
    input: "Full image + structured prompt listing candidate bounding boxes and preliminary types.",
    output: "Structured JSON proposing redactions, rationale, and visual context summaries.",
    technology: "FastVLM-0.5B ONNX (fp16 embeddings, q4f16 vision and decoder layers).",
    executionProvider: "WebGPU (high-performance) with CPU retry",
    whyItExists: "Disambiguates visual context: e.g. distinguishing a public demo card number in a documentation graphic from a live checkout form.",
    failureBehavior: "CRITICAL: FastVLM is NEVER treated as final authority. If JSON output is malformed, truncated, or hallucinated, Safety Gate rejects it.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/prompts.js",
      "extension/v7 beta/src/pipeline/safety.js"
    ]
  },
  {
    id: 6,
    name: "Candidate Fusion",
    tag: "ARBITRATION",
    icon: "⚡",
    shortDesc: "Merges overlapping detections from OCR, Ettin NER, BlazeFace, and FastVLM into unified candidate entities.",
    input: "Raw candidates from all detection streams.",
    output: "Unified candidate records: `{ candidate_id, ocr_ids, text, candidate_types, confidence, sources }`.",
    technology: "Spatial IoU overlap matching, span reconciliation, and confidence weighting.",
    executionProvider: "Native JavaScript Logic",
    whyItExists: "Prevents duplicate redacting boxes and resolves conflicts between different detection models.",
    failureBehavior: "Union-conservative: if any high-confidence detector flagged a segment, candidate is preserved.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/v7-extension.js",
      "extension/v7 beta/src/pipeline/heuristics.js"
    ]
  },
  {
    id: 7,
    name: "Safety Gates & Verification",
    tag: "ZERO-TRUST GATE",
    icon: "🛡️",
    shortDesc: "Enforces strict validation rules: FastVLM proposals MUST reference existing fused candidates.",
    input: "FastVLM JSON proposal vs ground-truth fused candidates list.",
    output: "Validated redaction list OR clean fallback to deterministic fused candidates (`fusion_fallback`).",
    technology: "Deterministic AST parser, candidate ID cross-check, type whitelist validation.",
    executionProvider: "Pure Synchronous TypeScript / JavaScript",
    whyItExists: "Stops hallucinated coordinates or AI jailbreaks from bypassing redaction or masking harmless areas.",
    failureBehavior: "Fail-closed: if FastVLM returns invalid JSON or unmapped IDs, execution automatically triggers `fusion_fallback`.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/safety.js",
      "extension/v7 beta/src/pipeline/heuristics.js"
    ]
  },
  {
    id: 8,
    name: "Value-Only Geometry Resolution",
    tag: "SURGICAL REDACTION",
    icon: "📐",
    shortDesc: "Calculates precise sub-bounding boxes for sensitive values, preserving field labels and UI structure.",
    input: "OCR line bounding box (e.g., 'Card Number: 4532 8812 0019 3321').",
    output: "Sub-box covering ONLY '4532 8812 0019 3321', keeping 'Card Number:' visible.",
    technology: "Exact substring match, character-width proportional sub-box estimation, label isolation.",
    executionProvider: "Geometric Math Algorithms",
    whyItExists: "AI agents need to know what fields exist on screen to perform tasks without seeing the secret values themselves.",
    failureBehavior: "If proportional sub-box cannot be calculated safely, conservatively redacts the entire OCR bounding box.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/heuristics.js",
      "extension/v7 beta/src/pipeline/safety.js"
    ]
  },
  {
    id: 9,
    name: "Canvas Redaction",
    tag: "PIXEL MUTATION",
    icon: "🎨",
    shortDesc: "Modifies the image buffer in-memory using reversible blur or irreversible solid black overlays.",
    input: "Original Canvas context + validated bounding boxes [ymin, xmin, ymax, xmax].",
    output: "Sanitized image data URL (PNG) with zero residual sensitive pixel data.",
    technology: "Canvas 2D API (multi-pass Gaussian box blur + opacity tint wash, or opaque fillRect).",
    executionProvider: "Hardware-accelerated HTML5 Canvas",
    whyItExists: "Guarantees that raw pixels are physically overwritten in bitmap memory before crossing any network or IPC boundary.",
    failureBehavior: "Bboxes are strictly clamped to [0, 0, width, height] preventing canvas overflow exceptions.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/canvas-redactor.js"
    ]
  },
  {
    id: 10,
    name: "Caption Scrubbing & Evidence Object",
    tag: "PROVABLE AUDIT",
    icon: "📋",
    shortDesc: "Replaces text occurrences with `[REDACTED:TYPE]` and generates tamper-evident JSON audit trail.",
    input: "Vision model description + validated redactions list.",
    output: "Scrubbed caption string + full evidence telemetry object.",
    technology: "Regex token replacement + JSON serialization.",
    executionProvider: "Native JavaScript",
    whyItExists: "Ensures that visual descriptions and agent tool logs contain no leaked sensitive values, with full auditable proof for human review.",
    failureBehavior: "If caption scrubbing fails, caption is replaced with generic safe placeholder.",
    sourceFiles: [
      "extension/v7 beta/src/pipeline/v7-extension.js",
      "extension/v7 beta/src/offscreen/offscreen.js"
    ]
  }
];

export function InteractivePipeline() {
  const [selectedId, setSelectedId] = useState<number>(1);
  const activeStage = STAGES.find((s) => s.id === selectedId) || STAGES[0];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg my-8">
      {/* Header */}
      <div className="p-6 border-b border-[var(--border)] bg-gradient-to-r from-[var(--card)] via-[var(--card-soft)] to-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
              10-STAGE ON-DEVICE PIPELINE
            </span>
            <h3 className="text-xl font-black mt-2 text-[var(--text)] tracking-tight">
              Interactive Perception & Redaction Architecture
            </h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              Click any stage below to inspect its data contract, underlying models, fail-closed behavior, and source files.
            </p>
          </div>
          <div className="text-xs font-mono text-[var(--faint)] bg-[var(--bg)] px-3 py-1.5 rounded-lg border border-[var(--border)]">
            Active: Stage {activeStage.id}/10 ({activeStage.name})
          </div>
        </div>
      </div>

      {/* Stepper Grid */}
      <div className="p-4 bg-[var(--bg-soft)] border-b border-[var(--border)] overflow-x-auto">
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 min-w-[700px] lg:min-w-0">
          {STAGES.map((stage) => {
            const isSelected = stage.id === selectedId;
            return (
              <button
                key={stage.id}
                onClick={() => setSelectedId(stage.id)}
                className={`p-2.5 rounded-xl text-left transition-all border flex flex-col justify-between h-[84px] ${
                  isSelected
                    ? "bg-[var(--card)] border-[var(--accent)] shadow-md ring-2 ring-[var(--accent)]/20 text-[var(--text)]"
                    : "bg-[var(--card)]/60 border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--card)] text-[var(--muted)]"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-base">{stage.icon}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      isSelected
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--card-soft)] text-[var(--faint)]"
                    }`}
                  >
                    0{stage.id}
                  </span>
                </div>
                <div className="text-[11px] font-bold leading-tight line-clamp-2 mt-1">
                  {stage.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Stage Detail View */}
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-3xl p-3 rounded-2xl bg-[var(--card-soft)] border border-[var(--border)]">
              {activeStage.icon}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[var(--accent)] text-white">
                  STAGE 0{activeStage.id}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
                  {activeStage.tag}
                </span>
              </div>
              <h4 className="text-2xl font-black mt-1 text-[var(--text)]">
                {activeStage.name}
              </h4>
            </div>
          </div>
          <div className="text-left md:text-right">
            <span className="text-[11px] text-[var(--faint)] block uppercase tracking-wider font-semibold">
              Execution Provider
            </span>
            <span className="inline-block mt-1 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              ⚡ {activeStage.executionProvider}
            </span>
          </div>
        </div>

        {/* Short description */}
        <p className="text-base text-[var(--text)] leading-relaxed font-medium">
          {activeStage.shortDesc}
        </p>

        {/* Technical Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)] uppercase tracking-wide">
              <span>📥</span> Input Contract
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed font-mono">
              {activeStage.input}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent-2)] uppercase tracking-wide">
              <span>📤</span> Output Contract
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed font-mono">
              {activeStage.output}
            </p>
          </div>
        </div>

        {/* Why it exists + Failure Behavior */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-1">
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              💡 Why This Stage Exists
            </div>
            <p className="text-xs text-[var(--text)] leading-relaxed">
              {activeStage.whyItExists}
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-1">
            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              🛡️ Fail-Closed Behavior
            </div>
            <p className="text-xs text-[var(--text)] leading-relaxed">
              {activeStage.failureBehavior}
            </p>
          </div>
        </div>

        {/* Underlying Tech and Source Files */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-[var(--border)] text-xs text-[var(--muted)]">
          <div>
            <span className="font-semibold text-[var(--text)]">Technology:</span>{" "}
            <span className="font-mono text-[var(--muted)]">{activeStage.technology}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[var(--text)]">Source:</span>
            {activeStage.sourceFiles.map((file, i) => (
              <code
                key={i}
                className="px-2 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-[11px] font-mono text-[var(--prose-code)]"
              >
                {file.split("/").pop()}
              </code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
