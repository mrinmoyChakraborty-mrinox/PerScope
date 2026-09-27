import Link from "next/link";
import { InteractivePipeline } from "@/components/InteractivePipeline";
import { ModeExplorer } from "@/components/ModeExplorer";
import { TrustBoundaryDiagram } from "@/components/TrustBoundaryDiagram";
import { CapabilityMatrix } from "@/components/CapabilityMatrix";

export default function Home() {
  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--card)] p-6 sm:p-10 md:p-12 shadow-sm">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-blue-500/10 via-teal-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl space-y-6">
          {/* SIH Metadata Pill */}
          <div className="inline-flex flex-wrap items-center gap-2 text-xs font-mono px-3.5 py-1.5 rounded-full bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-[var(--text)]">SIH26171</span>
            <span>·</span>
            <span>ISRO / Smart Automation</span>
            <span>·</span>
            <span className="text-[var(--accent)] font-semibold">Team Cosmic Crux</span>
          </div>

          {/* Punchy Title */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-[var(--text)] leading-[1.08]">
            PerScope —{" "}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-teal-500 dark:from-[#cbb8ff] dark:via-[#7c5cff] dark:to-[#00e5a0] bg-clip-text text-transparent">
              See everything.
            </span>{" "}
            Leak nothing.
          </h1>

          {/* Subtitle / Core Explanation */}
          <p className="text-base sm:text-lg text-[var(--muted)] leading-relaxed max-w-3xl">
            A privacy-preserving browser-agent perception layer where visual intelligence and sensitive-data sanitization
            occur <strong className="text-[var(--text)]">100% locally on-device</strong> before sanitized context crosses the trust boundary to any AI agent or cloud LLM.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/judge"
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm hover:opacity-95 shadow-lg shadow-emerald-500/20 transition flex items-center gap-2"
            >
              <span>⚡</span> Judge Mode (60s Pitch)
            </Link>
            <Link
              href="/user-flows"
              className="px-5 py-3 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm hover:opacity-90 transition shadow-sm"
            >
              👤 Explore User Flows
            </Link>
            <Link
              href="/architecture"
              className="px-5 py-3 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-soft)] text-sm font-semibold text-[var(--text)] transition"
            >
              📐 Architecture
            </Link>
            <Link
              href="/quick-start"
              className="px-5 py-3 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-soft)] text-sm font-semibold text-[var(--text)] transition"
            >
              🚀 Quick Start
            </Link>
          </div>

          {/* Verified Invariant Badges */}
          <div className="flex flex-wrap gap-2 pt-2 text-xs font-mono text-[var(--faint)]">
            <span className="px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)]">
              🔒 0 Cloud Calls in Tested Flow
            </span>
            <span className="px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)]">
              ⚡ WebGPU + WASM SIMD
            </span>
            <span className="px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)]">
              🛡️ Fail-Closed Safety Gates
            </span>
            <span className="px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)]">
              🤖 MCP Stdio / HTTP Bridge
            </span>
          </div>
        </div>
      </section>

      {/* "Why PerScope?" Everyday Browser Agent Scenario */}
      <section className="space-y-6">
        <div className="space-y-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            THE CORE PROBLEM
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">
            Why Does Browser AI Need PerScope?
          </h2>
          <p className="text-sm text-[var(--muted)] max-w-3xl leading-relaxed">
            Every day, users ask autonomous agents or browser assistants: <em>&ldquo;Summarize this page&rdquo;</em>, <em>&ldquo;Help me compare these flights&rdquo;</em>, or <em>&ldquo;Fill out this form&rdquo;</em>.
            However, the webpage frequently contains sensitive private context: emails, phone numbers, account balances, biometric faces, and authentication credentials.
          </p>
        </div>

        {/* Before vs After Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Without PerScope (Danger) */}
          <div className="rounded-2xl border-2 border-red-500/30 bg-red-50/20 dark:bg-red-950/10 p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-red-500/20">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <span>⚠️</span> Traditional Browser Agents
              </span>
              <span className="text-[11px] font-bold text-red-600">UNSAFE / HIGH RISK</span>
            </div>
            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-lg bg-[var(--card)] border border-red-500/20">
                1. User opens page with banking, email, or medical records.
              </div>
              <div className="text-center text-red-500 font-bold">↓ (Raw Viewport Sent Direct to Cloud)</div>
              <div className="p-3 rounded-lg bg-[var(--card)] border border-red-500/20 text-red-600 dark:text-red-400">
                2. Raw pixels + sensitive PII (credit cards, passwords, SSN) transmitted unredacted to external LLM servers.
              </div>
              <div className="text-center text-red-500 font-bold">↓ (Vulnerable Boundary)</div>
              <div className="p-3 rounded-lg bg-[var(--card)] border border-red-500/20 text-red-600 dark:text-red-400">
                3. Risk of corporate data breach, training set leakage, biometric tracking, and indirect prompt injection.
              </div>
            </div>
          </div>

          {/* With PerScope (Safe Enclave) */}
          <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10 p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span>🛡️</span> With PerScope Zero-Trust Enclave
              </span>
              <span className="text-[11px] font-bold text-emerald-600">HARDWARE-ENFORCED PRIVACY</span>
            </div>
            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-lg bg-[var(--card)] border border-emerald-500/20">
                1. User or AI requests visual perception of the browser tab.
              </div>
              <div className="text-center text-emerald-500 font-bold">↓ (Local MV3 Offscreen Worker)</div>
              <div className="p-3 rounded-lg bg-[var(--card)] border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                2. On-device WebGPU runs BlazeFace + PaddleOCR + Ettin-68M + FastVLM. Values masked; labels preserved.
              </div>
              <div className="text-center text-emerald-500 font-bold">↓ (Sanitized Context Only)</div>
              <div className="p-3 rounded-lg bg-[var(--card)] border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                3. Only sanitized pixels + scrubbed captions + verified evidence cross boundary. Raw secrets stay local.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Modes Preview (Human vs Bridge) */}
      <section>
        <ModeExplorer />
      </section>

      {/* Interactive 10-Stage Pipeline */}
      <section>
        <InteractivePipeline />
      </section>

      {/* Trust Boundary Diagram */}
      <section>
        <TrustBoundaryDiagram />
      </section>

      {/* Tested vs Planned Matrix */}
      <section>
        <CapabilityMatrix />
      </section>

      {/* Real-World Failure Mitigation Grid */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            DEFENSE IN DEPTH
          </span>
          <h3 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Real-World Browser-Agent Risks Mitigated by PerScope
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            How PerScope protects users against the 3 primary vulnerabilities in modern agentic browser automation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-3">
            <div className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>🔓</span> 1. Sensitive Context Leakage
            </div>
            <div className="text-sm font-bold text-[var(--text)]">Unintended PII Exposure</div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Autonomous agents capture entire viewports to locate a single button, inadvertently sending account numbers and personal details to cloud logs.
            </p>
            <div className="pt-2 border-t border-[var(--border)] text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              ✓ Solved by Value-Only Canvas Redaction & Caption Scrubbing
            </div>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-3">
            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>💉</span> 2. Indirect Prompt Injection
            </div>
            <div className="text-sm font-bold text-[var(--text)]">Malicious Web Text Overriding Agent</div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Adversarial web pages embed hidden text instructions instructing the agent to exfiltrate private credentials or navigate to malicious domains.
            </p>
            <div className="pt-2 border-t border-[var(--border)] text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              ✓ Solved by AST Schema Isolation & Local Heuristics
            </div>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-3">
            <div className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>💥</span> 3. Irreversible Browser Actions
            </div>
            <div className="text-sm font-bold text-[var(--text)]">Accidental Financial or Destructive Actions</div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Agents click destructive buttons (e.g. &ldquo;Delete Account&rdquo;, &ldquo;Confirm Payment&rdquo;) without human awareness or confirmation.
            </p>
            <div className="pt-2 border-t border-[var(--border)] text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              ✓ Solved by isDestructive() Classifier & Explicit Human Confirmation
            </div>
          </div>
        </div>
      </section>

      {/* Quick Navigation Footer Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/judge"
          className="p-5 rounded-xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 hover:border-emerald-500/50 transition space-y-2"
        >
          <div className="text-lg">⚡</div>
          <div className="text-sm font-bold text-[var(--text)]">Judge Mode (60s)</div>
          <div className="text-xs text-[var(--muted)]">Rapid evaluation summary, live simulator, and SIH scorecard alignment.</div>
        </Link>
        <Link
          href="/user-flows"
          className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition space-y-2"
        >
          <div className="text-lg">👤</div>
          <div className="text-sm font-bold text-[var(--text)]">User Flows & Personas</div>
          <div className="text-xs text-[var(--muted)]">Deep walkthrough of Human Mode, Bridge Mode, and 5 distinct user scenarios.</div>
        </Link>
        <Link
          href="/architecture"
          className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition space-y-2"
        >
          <div className="text-lg">📐</div>
          <div className="text-sm font-bold text-[var(--text)]">Architecture Deep Dive</div>
          <div className="text-xs text-[var(--muted)]">Extension internals, model lifecycle, WebGPU runtime, and message passing.</div>
        </Link>
        <Link
          href="/quick-start"
          className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition space-y-2"
        >
          <div className="text-lg">🚀</div>
          <div className="text-sm font-bold text-[var(--text)]">Quick Start & Setup</div>
          <div className="text-xs text-[var(--muted)]">Verified setup commands, loading the extension, and running test suites.</div>
        </Link>
      </section>
    </div>
  );
}
