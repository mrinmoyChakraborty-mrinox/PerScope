"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

export function ModeExplorer() {
  const [activeMode, setActiveMode] = useState<"human" | "bridge">("human");
  const [humanSubFlow, setHumanSubFlow] = useState<"screenshot" | "dom">("screenshot");

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg my-8">
      {/* Mode Switcher Tabs */}
      <div className="p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--card-soft)]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
            DUAL-OPERATING MODES
          </span>
          <h3 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            How PerScope Works: Human vs Bridge Mode
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            PerScope accommodates both interactive human workflows and autonomous AI agent operations under a unified zero-trust boundary.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-[var(--bg)] border border-[var(--border)] shadow-sm shrink-0">
          <button
            onClick={() => setActiveMode("human")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              activeMode === "human"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            <span>👤</span> Human Mode (Direct User)
          </button>
          <button
            onClick={() => setActiveMode("bridge")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              activeMode === "bridge"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            <span>🤖</span> Bridge Mode (Agentic MCP)
          </button>
        </div>
      </div>

      {/* Mode Content */}
      <div className="p-6 md:p-8">
        {activeMode === "human" ? (
          <div className="space-y-8">
            {/* Human Mode Intro */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Direct Browser Extension Experience · Zero Configuration Required
                </div>
                <h4 className="text-xl font-bold text-[var(--text)]">
                  Protect Your Personal Screen Before Sharing or Feeding to AI
                </h4>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  In Human Mode, the user drives PerScope directly through the Chrome extension popup or full-page dashboard.
                  Whether capturing a live tab or uploading confidential receipts, healthcare records, or terminal screenshots, all perception and redaction occurs on your machine.
                </p>
                <div className="flex flex-wrap gap-2 pt-1 text-xs">
                  <span className="px-2.5 py-1 rounded-md bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
                    ✓ Zero cloud calls
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
                    ✓ WebGPU / WASM execution
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
                    ✓ Live DOM non-mutation
                  </span>
                </div>
              </div>

              {/* Sub-flow selector */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 p-4 space-y-3">
                <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                  Select User Flow:
                </div>
                <button
                  onClick={() => setHumanSubFlow("screenshot")}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-medium border transition ${
                    humanSubFlow === "screenshot"
                      ? "bg-[var(--card)] border-[var(--accent)] text-[var(--text)] shadow-sm font-semibold"
                      : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--card)]"
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5">
                    <span>🖼️</span> Tab / Screenshot Redaction
                  </div>
                  <div className="text-[11px] text-[var(--faint)] mt-0.5">
                    Capture tab, drag & drop, or paste screenshot
                  </div>
                </button>
                <button
                  onClick={() => setHumanSubFlow("dom")}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-medium border transition ${
                    humanSubFlow === "dom"
                      ? "bg-[var(--card)] border-[var(--accent)] text-[var(--text)] shadow-sm font-semibold"
                      : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--card)]"
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5">
                    <span>📄</span> DOM Snapshot Text Capture
                  </div>
                  <div className="text-[11px] text-[var(--faint)] mt-0.5">
                    Structured text, form secrets, shadow DOM traversal
                  </div>
                </button>
              </div>
            </div>

            {/* Step-by-step diagram for selected subflow */}
            {humanSubFlow === "screenshot" ? (
              <div className="space-y-4">
                <div className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                  <span>📸</span> Step-by-Step Flow: Visual Screenshot Redaction
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent)]">STEP 01</div>
                    <div className="text-sm font-bold text-[var(--text)]">Ingestion</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Click <strong>Capture Tab</strong> or paste an image. Background sends pixels to MV3 offscreen document.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      CAPTURE_VISIBLE_TAB
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent)]">STEP 02</div>
                    <div className="text-sm font-bold text-[var(--text)]">Local Perception</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Offscreen runs BlazeFace, PaddleOCR, Ettin-68M, and FastVLM-0.5B locally with WebGPU.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      RUN_PIPELINE (Offscreen)
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent)]">STEP 03</div>
                    <div className="text-sm font-bold text-[var(--text)]">Safety Redaction</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Safety gate validates FastVLM; value-only sub-boxes are masked via Canvas 2D blur or black boxes.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      Canvas Dual-Pass Blur
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent)]">STEP 04</div>
                    <div className="text-sm font-bold text-[var(--text)]">Review & Export</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      User toggles Original/Redacted/Overlay views, reviews PII findings chips, and exports sanitized PNG + JSON.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      Sanitized PNG + Evidence
                    </code>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                  <span>📄</span> Step-by-Step Flow: Non-Mutating DOM Snapshot Capture
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent-2)]">STEP 01</div>
                    <div className="text-sm font-bold text-[var(--text)]">Trigger Capture</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      User clicks <strong>Capture DOM Text</strong>. Background worker dispatches capture message to the active tab.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      REQUEST_DOM_CAPTURE
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent-2)]">STEP 02</div>
                    <div className="text-sm font-bold text-[var(--text)]">Deep Tree Walk</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Content script recursively walks text, attributes, open shadow roots, and cross-origin iframes via postMessage.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      dom-capture.js (Walker)
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent-2)]">STEP 03</div>
                    <div className="text-sm font-bold text-[var(--text)]">Tier0 Sanitization</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Secret fields (passwords, tokens) are instantly masked; regex & Luhn algorithms redact PII per segment.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      piidetector.js / dom-heuristics
                    </code>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2">
                    <div className="text-xs font-mono font-bold text-[var(--accent-2)]">STEP 04</div>
                    <div className="text-sm font-bold text-[var(--text)]">Safe Rebuild & Zeroing</div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      Rebuilds block-aware document; zeroes raw memory and DOM paths. Returns clean text to user UI.
                    </p>
                    <code className="text-[10px] block p-1.5 rounded bg-[var(--code-bg)] text-[var(--prose-code)]">
                      Zero-Raw Hygiene Output
                    </code>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Bridge Mode Intro */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-3">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Autonomous Agentic Mode · Model Context Protocol (MCP) Integration
                </div>
                <h4 className="text-xl font-bold text-[var(--text)]">
                  Connect External AI Agents with a Hardware-Enforced Trust Boundary
                </h4>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  In Bridge Mode, autonomous AI assistants (like Claude Code, OpenCode, Cursor, or custom MCP agents) drive the browser to complete tasks.
                  Instead of giving the cloud model raw browser access, the agent communicates with the local <code>@perscope/bridge</code> daemon over stdio or HTTP.
                  The bridge relays requests to the extension offscreen document, where perception and redaction run locally before any data crosses to the agent.
                </p>
              </div>

              {/* Pairing Card */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 p-4 space-y-2">
                <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                  <span>🔐</span> Single-Use 6-Digit Pairing
                </div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  To prevent malicious local scripts from driving your browser, the bridge requires a 6-digit pairing handshake (rotating every 10 min, lock on 5 failed attempts).
                </p>
                <div className="p-2 rounded bg-[var(--code-bg)] font-mono text-center text-sm font-bold text-[var(--accent)] tracking-widest">
                  842 · 190
                </div>
                <span className="text-[10px] text-[var(--faint)] block text-center">
                  Persisted token saved with chmod 0600 in ~/.perscope/
                </span>
              </div>
            </div>

            {/* Architecture diagram for Bridge */}
            <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-4">
              <div className="text-sm font-bold text-[var(--text)] flex items-center justify-between">
                <span>⚡ Bridge Data Flow & Zero-Trust Protocol</span>
                <span className="text-xs font-mono text-[var(--faint)]">
                  Agent ↔ Bridge ↔ Extension
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-center">
                <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex flex-col justify-between">
                  <div className="text-xs font-bold text-purple-600 dark:text-purple-400">1. AI AGENT</div>
                  <div className="text-xs font-mono my-2 text-[var(--text)]">Claude / OpenCode</div>
                  <div className="text-[10px] text-[var(--faint)]">Calls MCP tool: capture_tab</div>
                </div>

                <div className="flex items-center justify-center text-xl text-[var(--faint)]">
                  →
                </div>

                <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex flex-col justify-between">
                  <div className="text-xs font-bold text-blue-600 dark:text-blue-400">2. BRIDGE DAEMON</div>
                  <div className="text-xs font-mono my-2 text-[var(--text)]">@perscope/bridge</div>
                  <div className="text-[10px] text-[var(--faint)]">Validates JSON schema, relays over WS (7331)</div>
                </div>

                <div className="flex items-center justify-center text-xl text-[var(--faint)]">
                  →
                </div>

                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 flex flex-col justify-between">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">3. EXTENSION OFFSCREEN</div>
                  <div className="text-xs font-mono my-2 text-[var(--text)]">Local WebGPU Pipeline</div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-300 font-semibold">Redacts PII ON-DEVICE before return</div>
                </div>
              </div>
            </div>

            {/* The Destructive Action Safety Gate */}
            <div className="rounded-xl border border-red-500/20 bg-red-50/40 dark:bg-red-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                <span>🛑</span> The Critical Safety Gate: isDestructive() Interception
              </div>
              <p className="text-xs text-[var(--text)] leading-relaxed">
                Autonomous agents often attempt actions that are dangerous or irreversible: clicking "Confirm Payment", deleting databases, or submitting forms.
                In PerScope, interactive tools (<code>click</code>, <code>type</code>, <code>select_option</code>, <code>submit</code>) pass through the <code>is-destructive.js</code> classifier.
                If flagged as destructive, the tool call halts and blocks for up to 60 seconds awaiting explicit human <strong>Approve / Deny</strong> in the extension UI.
              </p>
              <div className="flex flex-wrap gap-2 text-xs font-mono pt-1">
                <span className="px-2.5 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800">
                  Tool: click(selector: "#btn-pay-now")
                </span>
                <span className="px-2.5 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  State: WAITING_FOR_HUMAN_APPROVAL
                </span>
                <span className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-300">
                  Timeout: 60,000ms
                </span>
              </div>
            </div>

            {/* MCP Agent Config Example */}
            <div>
              <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2">
                Claude Code / OpenCode MCP Integration Config:
              </div>
              <CodeBlock
                language="bash"
                title="Register PerScope MCP in Claude Code"
                code={`# Register PerScope MCP server with Claude Code
claude mcp add perscope -- npx -y @perscope/bridge mcp

# Start the local daemon manually
npx perscope-bridge daemon`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
