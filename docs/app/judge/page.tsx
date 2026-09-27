import Link from "next/link";
import { JudgeDemoSimulator } from "@/components/JudgeDemoSimulator";
import { CapabilityMatrix } from "@/components/CapabilityMatrix";

export const metadata = {
  title: "PerScope — Judge Evaluation Mode | SIH26171 Cosmic Crux",
  description:
    "Executive 90-second evaluation dashboard for SIH judges. On-Device Visual Perception for Lightweight Browser Agents.",
};

export default function JudgePage() {
  return (
    <div className="space-y-10">
      {/* Judge Header Hero */}
      <section className="relative overflow-hidden rounded-[24px] border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-50/20 via-[var(--card)] to-blue-50/20 dark:from-emerald-950/20 dark:via-[var(--card)] dark:to-blue-950/20 p-6 sm:p-10 shadow-lg">
        <div className="max-w-4xl space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            OFFICIAL EVALUATION DASHBOARD · SIH26171
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-[var(--text)]">
            PerScope:{" "}
            <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-blue-600 bg-clip-text text-transparent">
              90-Second Judge Briefing
            </span>
          </h1>

          <p className="text-sm sm:text-base text-[var(--muted)] leading-relaxed max-w-3xl">
            Designed for SIH evaluators. Understand PerScope&rsquo;s core breakthrough, test results, hardware-enforced privacy guarantees, and verifiable code evidence in under two minutes.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-semibold">
            <a
              href="#demo"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm flex items-center gap-1.5"
            >
              <span>⚡</span> Jump to Live Simulator
            </a>
            <a
              href="#scorecard"
              className="px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-soft)] text-[var(--text)] transition"
            >
              📊 SIH Scorecard Mapping
            </a>
            <a
              href="#proof"
              className="px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-soft)] text-[var(--text)] transition"
            >
              🔒 Privacy Proof
            </a>
            <Link
              href="/architecture"
              className="px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-soft)] text-[var(--text)] transition"
            >
              📐 Full Technical Architecture →
            </Link>
          </div>
        </div>
      </section>

      {/* The 30-Second Problem & Solution Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Problem */}
        <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-3 shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 grid place-items-center font-bold text-sm">
            01
          </div>
          <h3 className="text-lg font-bold text-[var(--text)]">The Core Problem</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Existing browser-agent systems send raw user screens to remote vision-LLMs. Private credentials, biometric faces, medical records, and bank accounts are transmitted unredacted to external servers, exposing users to catastrophic data leaks and prompt injection.
          </p>
        </div>

        {/* Card 2: Solution */}
        <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-3 shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 grid place-items-center font-bold text-sm">
            02
          </div>
          <h3 className="text-lg font-bold text-[var(--text)]">The PerScope Solution</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            PerScope shifts perception and sanitization <strong className="text-[var(--text)]">directly onto the client device</strong>. Using WebGPU-accelerated local models (BlazeFace + PaddleOCR + Ettin-68M + FastVLM), it masks sensitive values while keeping field labels visible for agent operation.
          </p>
        </div>

        {/* Card 3: The Verification */}
        <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-3 shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 grid place-items-center font-bold text-sm">
            03
          </div>
          <h3 className="text-lg font-bold text-[var(--text)]">Ground-Truth Proof</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            The tested pipeline makes <strong className="text-[var(--text)]">exactly 0 cloud calls</strong>. Bounding boxes are physically modified on an in-memory Canvas buffer, captions are scrubbed to <code>[REDACTED:TYPE]</code>, and safety gates reject invalid model proposals fail-closed.
          </p>
        </div>
      </section>

      {/* Live 90-Second Demo Simulator */}
      <section id="demo" className="space-y-3 scroll-mt-20">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            INTERACTIVE EVALUATION
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Live Perception & Redaction Simulation
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Toggle views to witness how PerScope identifies biometric faces and credit card numbers, performs value-only redaction, and preserves critical UI labels.
          </p>
        </div>

        <JudgeDemoSimulator />
      </section>

      {/* SIH Evaluation Scorecard Alignment */}
      <section id="scorecard" className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6 scroll-mt-20">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            SIH26171 CRITERIA
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Alignment with SIH Problem Statement & Evaluation Criteria
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            How PerScope directly fulfills the core requirements of <em>On-Device Visual Perception for Lightweight Browser Agents</em>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
              1. Technical Novelty & Edge AI
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Demonstrates complete browser-side WebGPU execution using ONNX Runtime Web. Eliminates cloud inference costs while delivering sub-250ms perceptual pipeline speed on consumer hardware.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              2. Zero-Trust Trust Boundary
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Provides mathematical separation between local user data and external AI context. Raw pixels and unmasked PII strings never touch cloud sockets; only sanitized outputs cross the boundary.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
              3. Dual Human & Agentic Usability
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Works seamlessly for interactive direct users (Chrome extension popup & dashboard) as well as autonomous AI agents (Claude Code, OpenCode) through the standardized Model Context Protocol (MCP).
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              4. Engineering Honesty & Tested Rigor
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Explicit separation of verified tested components from planned roadmap items. Complete automated unit test suites covering DOM capture, pattern detection, safety gating, and destructive action interception.
            </p>
          </div>
        </div>
      </section>

      {/* Privacy Proof & Invariants */}
      <section id="proof" className="rounded-2xl border-2 border-emerald-500/20 bg-emerald-50/10 dark:bg-emerald-950/10 p-6 sm:p-8 space-y-6 scroll-mt-20">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            VERIFIABLE AUDIT TRAIL
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Privacy Proof & Core Invariants
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Claims supported by executable code in the repository.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1.5">
            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              🔒 Invariant 1: Zero Cloud Ingestion
            </div>
            <p className="text-xs text-[var(--muted)]">
              All tested models (BlazeFace, PaddleOCR, Ettin-68M, FastVLM) run in the browser offscreen document. Network tab reveals zero outgoing image payloads.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1.5">
            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              📐 Invariant 2: Value-Only Redaction
            </div>
            <p className="text-xs text-[var(--muted)]">
              Labels like &ldquo;Card Number:&rdquo; and &ldquo;Billing Address:&rdquo; remain fully legible. Only the sensitive value sub-box is obfuscated, preserving context for agent navigation.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1.5">
            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              🛡️ Invariant 3: Fail-Closed Safety Gates
            </div>
            <p className="text-xs text-[var(--muted)]">
              FastVLM vision proposals must reference valid fused candidates. If FastVLM outputs malformed JSON or invalid IDs, the pipeline defaults to deterministic fusion redaction.
            </p>
          </div>
        </div>
      </section>

      {/* Tested vs Planned Matrix */}
      <section className="space-y-4">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
            CAPABILITY AUDIT
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Tested Ground Truth vs Planned Scope
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Complete transparency on what is running today versus what is on the roadmap.
          </p>
        </div>

        <CapabilityMatrix />
      </section>

      {/* SIH PPT Presentation Talking Points */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
          <span>📢</span> Quick SIH Presentation Talking Points (Slide 3–6)
        </h3>
        <ul className="space-y-2.5 text-xs text-[var(--text)] leading-relaxed list-disc pl-5">
          <li>
            <strong>Problem Statement (SIH26171):</strong> Cloud-based browser agents create severe privacy leaks because raw screen pixels are sent across the network.
          </li>
          <li>
            <strong>PerScope Innovation:</strong> We deploy lightweight on-device models inside Chrome Manifest V3 using WebGPU, enforcing zero-trust before data leaves the machine.
          </li>
          <li>
            <strong>Why Not Just Regex?</strong> Regex cannot see images, icons, or visual structure; pure vision models hallucinate. PerScope combines PaddleOCR, Ettin-68M, deterministic validators, and FastVLM into a fused, safety-gated pipeline.
          </li>
          <li>
            <strong>Value-Only Redaction:</strong> AI agents need field labels to interact with forms. PerScope isolates sensitive values while preserving surrounding layout.
          </li>
          <li>
            <strong>Ecosystem Integration:</strong> Built with standard Model Context Protocol (MCP), allowing instant plug-and-play with Claude Code, OpenCode, and autonomous agents.
          </li>
        </ul>
      </section>
    </div>
  );
}
