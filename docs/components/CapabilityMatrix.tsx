"use client";

import { useState } from "react";

interface Capability {
  category: string;
  name: string;
  status: "tested" | "planned" | "experimental" | "limitation";
  details: string;
  evidenceFile: string;
}

const CAPABILITIES: Capability[] = [
  {
    category: "Visual Perception",
    name: "BlazeFace Face Detection",
    status: "tested",
    details: "128×128 NCHW ONNX model detects human faces and profile pictures with NMS IoU 0.3 threshold and confidence ≥ 0.6.",
    evidenceFile: "extension/v7 beta/src/pipeline/face.js"
  },
  {
    category: "Visual Perception",
    name: "PaddleOCR PP-OCRv6-small",
    status: "tested",
    details: "High-accuracy text localization and per-box OCR running in WASM SIMD environment with confidence filtering ≥ 0.5.",
    evidenceFile: "extension/v7 beta/src/pipeline/v7-extension.js"
  },
  {
    category: "PII Detection",
    name: "Ettin-68M Nemotron PII Classifier",
    status: "tested",
    details: "Token-level NER running on WebGPU with single-thread WASM fallback (avoids int64 encoder crash). Maps entities to OCR spans.",
    evidenceFile: "extension/v7 beta/src/pipeline/v7-extension.js"
  },
  {
    category: "PII Detection",
    name: "Deterministic Regex & Checksum Heuristics",
    status: "tested",
    details: "Luhn algorithm for credit cards, IBAN checksum, IPv4 structure, email, phone numbers, and API key detection.",
    evidenceFile: "piidetector.js & dom-heuristics.js"
  },
  {
    category: "Multimodal Adjudication",
    name: "FastVLM-0.5B Multimodal Adjudication",
    status: "tested",
    details: "Multimodal model evaluates visual context of detected candidates to resolve ambiguous page semantics.",
    evidenceFile: "extension/v7 beta/src/pipeline/safety.js"
  },
  {
    category: "Zero-Trust Enforcement",
    name: "Safety Gate & fusion_fallback",
    status: "tested",
    details: "FastVLM is NOT blindly trusted. If proposal references non-existent candidates or invalid types, pipeline fails closed to deterministic fusion.",
    evidenceFile: "extension/v7 beta/src/pipeline/safety.js"
  },
  {
    category: "Redaction Geometry",
    name: "Value-Only Geometry Resolution",
    status: "tested",
    details: "Calculates sub-bounding boxes for sensitive values, preserving field labels (e.g., 'Card Number:' remains visible, digits masked).",
    evidenceFile: "extension/v7 beta/src/pipeline/heuristics.js"
  },
  {
    category: "Pixel Protection",
    name: "Hardware-Accelerated Canvas Redaction",
    status: "tested",
    details: "Multi-pass Gaussian box blur with color tint or solid black boxes applied directly to canvas pixels; coordinates clamped to image bounds.",
    evidenceFile: "extension/v7 beta/src/pipeline/canvas-redactor.js"
  },
  {
    category: "Audit & Sanitization",
    name: "Caption Scrubbing & Evidence Object",
    status: "tested",
    details: "Replaces sensitive tokens in captions with [REDACTED:TYPE] and produces structured JSON evidence with compute device telemetry.",
    evidenceFile: "extension/v7 beta/src/pipeline/v7-extension.js"
  },
  {
    category: "DOM Sanitization",
    name: "Non-Mutating DOM Snapshot Walker",
    status: "tested",
    details: "Recursively captures text, form values, open shadow DOM, and cross-origin iframes; redacts PII before logging; zeroes raw memory.",
    evidenceFile: "extension/v7 beta/src/pipeline/dom-capture.js"
  },
  {
    category: "Agent Bridge",
    name: "@perscope/bridge Local Relay & MCP Server",
    status: "tested",
    details: "Node.js daemon holding paired WebSocket to extension; exposes stdio and streamable-HTTP MCP endpoints (ports 7331/7332).",
    evidenceFile: "bridge/src/daemon.js & mcp-server.js"
  },
  {
    category: "Agent Safety",
    name: "isDestructive() Action Classifier",
    status: "tested",
    details: "Unit-tested pure logic module classifying click/type/submit actions as destructive (payments, deletions, submissions) vs safe read actions.",
    evidenceFile: "extension/v7 beta/src/shared/is-destructive.js"
  },
  {
    category: "Agent Execution",
    name: "Live End-to-End DOM Action Execution",
    status: "planned",
    details: "Execution of DOM actions (click, type, submit) on live web elements. In beta, bridge tools return 'dom-not-implemented-in-beta'.",
    evidenceFile: "extension/v7 beta/src/offscreen/offscreen.js:123"
  },
  {
    category: "Reasoning Layer",
    name: "Full Cloud/Local Reasoning Server Integration",
    status: "planned",
    details: "Central reasoning server orchestrating multi-step browser agent plans. Server scripts exist in server/ but automated loop is planned.",
    evidenceFile: "server/index.js & ARCHITECTURE_SNAPSHOT.md"
  },
  {
    category: "Browser UI",
    name: "Automated Send-to-Chat Integration",
    status: "planned",
    details: "Direct one-click piping of sanitized image and prompt into ChatGPT/Claude web interfaces without manual paste.",
    evidenceFile: "claude_process_chat_mock.html"
  },
  {
    category: "Site Customization",
    name: "Per-Site Specialized Adapters",
    status: "planned",
    details: "Custom site-specific heuristics for high-security portals (e.g. online banking, IRS tax filing).",
    evidenceFile: "PerScope_User_Guide.md"
  },
  {
    category: "Cross-Platform",
    name: "Firefox MV3 Browser Validation",
    status: "limitation",
    details: "Extension is architected for Chromium Manifest V3 (Chrome 116+). Firefox MV3 offscreen document support is not yet validated.",
    evidenceFile: "extension/v7 beta/manifest.json"
  },
  {
    category: "Runtime Speed",
    name: "WASM CPU Fallback Latency",
    status: "limitation",
    details: "Devices without dedicated WebGPU hardware fall back to WASM SIMD, which takes ~3-8x longer for perception models than WebGPU.",
    evidenceFile: "extension/v7 beta/src/pipeline/gpu.js"
  }
];

export function CapabilityMatrix() {
  const [filter, setFilter] = useState<"all" | "tested" | "planned" | "limitation">("all");

  const filtered = CAPABILITIES.filter((c) => {
    if (filter === "all") return true;
    if (filter === "tested") return c.status === "tested";
    if (filter === "planned") return c.status === "planned";
    if (filter === "limitation") return c.status === "limitation";
    return true;
  });

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg my-8">
      {/* Header */}
      <div className="p-6 border-b border-[var(--border)] bg-gradient-to-r from-[var(--card)] via-[var(--card-soft)] to-[var(--card)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
              AUDIT & VERIFICATION MATRIX
            </span>
            <h3 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
              Tested Ground Truth vs Planned Capabilities
            </h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              Every status below is verified against actual disk code in the repository. We do not present planned features as completed.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="inline-flex p-1 rounded-xl bg-[var(--bg)] border border-[var(--border)] shrink-0">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === "all" ? "bg-[var(--accent)] text-white" : "text-[var(--muted)]"
              }`}
            >
              All ({CAPABILITIES.length})
            </button>
            <button
              onClick={() => setFilter("tested")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${
                filter === "tested" ? "bg-emerald-600 text-white" : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              <span>✅</span> Tested (12)
            </button>
            <button
              onClick={() => setFilter("planned")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${
                filter === "planned" ? "bg-blue-600 text-white" : "text-blue-600 dark:text-blue-400"
              }`}
            >
              <span>🔵</span> Planned (4)
            </button>
            <button
              onClick={() => setFilter("limitation")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${
                filter === "limitation" ? "bg-amber-600 text-white" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              <span>⚠️</span> Limitations (2)
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-[var(--card-soft)] text-[var(--muted)] uppercase font-semibold text-[11px] border-b border-[var(--border)]">
            <tr>
              <th className="p-4">Feature / Module</th>
              <th className="p-4">Status</th>
              <th className="p-4">Verified Capability & Scope</th>
              <th className="p-4">Repository Evidence File</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((item, idx) => {
              const badgeClass =
                item.status === "tested"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : item.status === "planned"
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";

              const badgeIcon =
                item.status === "tested" ? "✅ TESTED" : item.status === "planned" ? "🔵 PLANNED" : "⚠️ LIMITATION";

              return (
                <tr key={idx} className="hover:bg-[var(--card-soft)]/50 transition">
                  <td className="p-4 font-bold text-[var(--text)] whitespace-nowrap">
                    <div>{item.name}</div>
                    <span className="text-[10px] font-normal text-[var(--faint)]">{item.category}</span>
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border ${badgeClass}`}>
                      {badgeIcon}
                    </span>
                  </td>
                  <td className="p-4 text-[var(--muted)] leading-relaxed min-w-[280px]">
                    {item.details}
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    <code className="px-2 py-1 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-[11px] font-mono text-[var(--prose-code)]">
                      {item.evidenceFile}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
