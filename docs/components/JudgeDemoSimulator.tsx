"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

export function JudgeDemoSimulator() {
  const [viewMode, setViewMode] = useState<"original" | "overlay" | "redacted" | "evidence">("redacted");

  const evidenceJson = {
    jobId: "job-per-8942-live",
    computeDevice: {
      backend: "WebGPU",
      adapterVendor: "NVIDIA",
      deviceTier: "dedicated",
      powerMode: "high-performance"
    },
    totalTimeMs: 214,
    cloudCalls: 0,
    pipeline: {
      faceDetection: {
        model: "BlazeFace-ONNX",
        facesDetected: 1,
        timeMs: 22
      },
      ocr: {
        model: "PaddleOCR-PP-OCRv6-small",
        tokensExtracted: 38,
        timeMs: 78
      },
      ner: {
        model: "Ettin-68M-Nemotron-PII",
        entitiesFound: 3,
        timeMs: 44
      },
      visualAdjudication: {
        model: "FastVLM-0.5B-ONNX",
        adjudicationStatus: "validated",
        timeMs: 62
      },
      safetyGate: {
        passed: true,
        unmappedProposals: 0,
        fallbackTriggered: false
      }
    },
    scrubbedCaption: "A checkout summary page for customer [REDACTED:PERSON] displaying billing address and payment method ending in [REDACTED:CREDIT_CARD].",
    redactions: [
      {
        candidate_id: "cand-face-01",
        type: "biometric_face",
        confidence: 0.98,
        decision_source: "blazeface_onnx",
        bbox: [18, 792, 110, 884],
        redactionStyle: "gaussian_blur"
      },
      {
        candidate_id: "cand-cc-02",
        type: "credit_card",
        confidence: 0.99,
        decision_source: "heuristic_luhn_fused",
        textValueMasked: "•••• •••• •••• 8841",
        labelPreserved: "Card Number:",
        bbox: [248, 220, 276, 440],
        redactionStyle: "dual_pass_blur"
      },
      {
        candidate_id: "cand-email-03",
        type: "email_address",
        confidence: 0.96,
        decision_source: "ettin_ner_regex",
        textValueMasked: "[REDACTED:EMAIL]",
        labelPreserved: "Contact Email:",
        bbox: [312, 220, 338, 410],
        redactionStyle: "solid_black"
      }
    ]
  };

  return (
    <div className="rounded-2xl border-2 border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-xl my-6">
      {/* Top Banner */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-emerald-600/10 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white grid place-items-center font-bold text-sm shadow-md">
            ⚡
          </span>
          <div>
            <div className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--accent)]">
              Interactive SIH Evaluation Simulation
            </div>
            <h4 className="text-lg font-black text-[var(--text)]">
              Live Perception & Redaction Verification Canvas
            </h4>
          </div>
        </div>

        {/* View Mode Buttons */}
        <div className="flex flex-wrap p-1 rounded-xl bg-[var(--bg)] border border-[var(--border)] gap-1">
          <button
            onClick={() => setViewMode("original")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === "original"
                ? "bg-red-500 text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            1. Raw Input (Unsafe)
          </button>
          <button
            onClick={() => setViewMode("overlay")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === "overlay"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            2. Detected BBoxes
          </button>
          <button
            onClick={() => setViewMode("redacted")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === "redacted"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            3. Value-Only Redacted
          </button>
          <button
            onClick={() => setViewMode("evidence")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === "evidence"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            4. Evidence JSON
          </button>
        </div>
      </div>

      {/* Main Canvas Workspace */}
      <div className="p-6 md:p-8">
        {viewMode === "evidence" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>
                Generated by <code>extension/v7 beta/src/pipeline/v7-extension.js</code>
              </span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                ✓ Verified Zero Unmasked PII In Evidence
              </span>
            </div>
            <CodeBlock
              language="json"
              title="PerScope Evidence Telemetry"
              code={JSON.stringify(evidenceJson, null, 2)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {/* The Visual Browser Mockup */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-4 sm:p-6 shadow-inner relative overflow-hidden font-sans">
              {/* Simulated Browser Chrome Bar */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="w-3 h-3 rounded-full bg-emerald-400" />
                  <span className="ml-2 font-mono text-[11px] text-[var(--faint)]">
                    https://secure-checkout.portal/account/billing
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                    🔒 PerScope Protection Active
                  </span>
                </div>
              </div>

              {/* Checkout Content Layout */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Billing Details (Left 2 cols) */}
                <div className="md:col-span-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-base text-[var(--text)]">
                      Order & Payment Details
                    </h5>
                    <span className="text-xs px-2 py-0.5 rounded bg-[var(--card-soft)] text-[var(--faint)]">
                      Order #PS-9821
                    </span>
                  </div>

                  {/* Form Field 1: Customer Name */}
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] flex items-center justify-between relative">
                    <span className="text-xs font-semibold text-[var(--text)]">
                      Customer Name:
                    </span>
                    <div className="text-xs font-mono relative">
                      {viewMode === "original" && (
                        <span className="text-red-600 font-bold">Dr. Aryan Sharma</span>
                      )}
                      {viewMode === "overlay" && (
                        <div className="relative inline-block border-2 border-dashed border-red-500 bg-red-500/10 px-1 py-0.5 rounded">
                          <span className="text-red-600 font-bold">Dr. Aryan Sharma</span>
                          <span className="absolute -top-3 right-0 text-[9px] font-bold bg-red-500 text-white px-1 rounded">
                            NER: PERSON (0.97)
                          </span>
                        </div>
                      )}
                      {viewMode === "redacted" && (
                        <span className="px-3 py-1 rounded bg-zinc-800 text-zinc-400 blur-[2px] select-none">
                          Dr. Aryan Sharma
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Form Field 2: Credit Card Number (Value-Only Demonstration!) */}
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] flex items-center justify-between relative">
                    <span className="text-xs font-semibold text-[var(--text)]">
                      Card Number:
                    </span>
                    <div className="text-xs font-mono relative">
                      {viewMode === "original" && (
                        <span className="text-red-600 font-bold">4532 · 8812 · 0019 · 8841</span>
                      )}
                      {viewMode === "overlay" && (
                        <div className="relative inline-block border-2 border-dashed border-blue-500 bg-blue-500/10 px-1 py-0.5 rounded">
                          <span className="text-blue-600 font-bold">4532 · 8812 · 0019 · 8841</span>
                          <span className="absolute -top-3 right-0 text-[9px] font-bold bg-blue-500 text-white px-1 rounded">
                            LUHN: CREDIT_CARD (0.99)
                          </span>
                        </div>
                      )}
                      {viewMode === "redacted" && (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="px-3 py-0.5 rounded bg-zinc-900 text-zinc-100 font-mono text-[11px] select-none">
                            [REDACTED:CREDIT_CARD]
                          </span>
                          <span className="text-[10px] text-emerald-600 font-semibold">
                            (Label Kept Visible)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Form Field 3: Contact Email */}
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] flex items-center justify-between relative">
                    <span className="text-xs font-semibold text-[var(--text)]">
                      Contact Email:
                    </span>
                    <div className="text-xs font-mono relative">
                      {viewMode === "original" && (
                        <span className="text-red-600 font-bold">aryan.sharma@research.isro.in</span>
                      )}
                      {viewMode === "overlay" && (
                        <div className="relative inline-block border-2 border-dashed border-amber-500 bg-amber-500/10 px-1 py-0.5 rounded">
                          <span className="text-amber-600 font-bold">aryan.sharma@research.isro.in</span>
                          <span className="absolute -top-3 right-0 text-[9px] font-bold bg-amber-500 text-white px-1 rounded">
                            REGEX: EMAIL (0.96)
                          </span>
                        </div>
                      )}
                      {viewMode === "redacted" && (
                        <span className="px-3 py-1 rounded bg-black text-white font-mono text-[11px] select-none">
                          █████████████████████████
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Profile Card with Biometric Face Detection (Right Col) */}
                <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)] flex flex-col items-center justify-center text-center space-y-3 relative">
                  <div className="relative">
                    {/* Simulated avatar circle */}
                    <div
                      className={`w-20 h-20 rounded-full border-2 border-[var(--border)] overflow-hidden flex items-center justify-center bg-gradient-to-tr from-amber-200 to-orange-400 text-3xl shadow-md transition-all ${
                        viewMode === "redacted" ? "filter blur-md select-none" : ""
                      }`}
                    >
                      👨‍🔬
                    </div>
                    {viewMode === "overlay" && (
                      <div className="absolute inset-0 rounded-full border-2 border-emerald-500 ring-2 ring-emerald-500/30 flex items-center justify-center">
                        <span className="absolute -bottom-2 text-[9px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded-full">
                          BLAZEFACE (0.98)
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--text)]">
                      Biometric Face Detection
                    </div>
                    <span className="text-[10px] text-[var(--muted)]">
                      BlazeFace ONNX on-device
                    </span>
                  </div>
                </div>
              </div>

              {/* Caption Bar */}
              <div className="mt-6 pt-4 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-[var(--text)]">Visual Caption: </span>
                  <span className="font-mono text-[var(--muted)]">
                    {viewMode === "original"
                      ? "A checkout page showing Dr. Aryan Sharma's billing details and card number 4532 8812 0019 8841."
                      : "A checkout summary page for customer [REDACTED:PERSON] displaying billing address and payment method ending in [REDACTED:CREDIT_CARD]."}
                  </span>
                </div>
                <div className="shrink-0 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                  Scrubbed with [REDACTED:TYPE]
                </div>
              </div>
            </div>

            {/* Hardware Telemetry Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <span className="text-[10px] text-[var(--faint)] block uppercase font-semibold">
                  Compute Device
                </span>
                <span className="text-xs font-bold text-[var(--text)] font-mono">
                  WebGPU (Dedicated)
                </span>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <span className="text-[10px] text-[var(--faint)] block uppercase font-semibold">
                  Execution Latency
                </span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                  214 ms
                </span>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <span className="text-[10px] text-[var(--faint)] block uppercase font-semibold">
                  Cloud Network Calls
                </span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                  0 (100% Local)
                </span>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <span className="text-[10px] text-[var(--faint)] block uppercase font-semibold">
                  Safety Gate
                </span>
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 font-mono">
                  PASSED (0 unmapped)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
