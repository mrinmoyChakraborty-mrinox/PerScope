export const metadata = {
  title: "PerScope — Known Limitations & Edge Cases | SIH26171",
  description:
    "Transparent documentation of technical limitations, hardware trade-offs, and edge cases in the current PerScope implementation.",
};

const LIMITATIONS = [
  {
    title: "1. FastVLM-0.5B Schema Misses & Truncation",
    category: "Multimodal Inference",
    impact: "Moderate",
    description:
      "Because FastVLM-0.5B is a lightweight 500M parameter model, it occasionally outputs truncated JSON or slightly bland captions when operating under strict token generation limits.",
    mitigation:
      "PerScope's safety.js implements extractJsonObject() with automatic brace recovery. If the JSON remains invalid or misses candidate IDs, the pipeline triggers fusion_fallback to deterministic signals fail-closed."
  },
  {
    title: "2. Heuristics Edge-Case Over-Redaction",
    category: "PII Detection",
    impact: "Low to Moderate",
    description:
      "Deterministic regex patterns (such as general numeric sequences resembling credit cards or tracking IDs) may occasionally over-redact harmless product serial numbers or public transaction references.",
    mitigation:
      "Checksum algorithms (Luhn algorithm for credit cards, IBAN modulo-97 check, and IPv4 range validators) are applied before confirmation to minimize false positives."
  },
  {
    title: "3. WASM CPU Fallback Latency",
    category: "Hardware Runtime",
    impact: "Performance Only",
    description:
      "On hardware lacking WebGPU support (older CPUs or machines without dedicated graphics), the pipeline falls back to WASM SIMD. This increases perception latency from ~210ms up to 1.5–3.5s.",
    mitigation:
      "Session caching and idle pre-warming (_prewarmModels() in requestIdleCallback) keep sessions ready in memory so subsequent runs avoid cold-start compilation overhead."
  },
  {
    title: "4. Interactive Action Execution is Beta-Deferred",
    category: "Agent Automation",
    impact: "Scope Constraint",
    description:
      "While the isDestructive() action classifier and unit test harness are fully built, actual execution of click, type, and submit actions on the live web DOM is deferred to the final release (returns 'dom-not-implemented-in-beta').",
    mitigation:
      "Safe by design: preventing half-built action replay ensures agents cannot trigger unconfirmed mutations during testing."
  },
  {
    title: "5. Chromium MV3 Exclusive (Firefox Not Validated)",
    category: "Platform Support",
    impact: "Browser Compatibility",
    description:
      "PerScope is optimized for Chromium (Google Chrome 116+, Microsoft Edge) utilizing the chrome.offscreen API. Firefox has differing implementations of offscreen documents and WebGPU permissions.",
    mitigation:
      "Chromium represents over 75% of global desktop browser usage. Cross-browser polyfilling is planned for future post-hackathon releases."
  },
  {
    title: "6. Centralized Reasoning Server is Planned",
    category: "System Orchestration",
    impact: "Agent Loop",
    description:
      "A centralized reasoning server for multi-turn browser planning is prototyped in server/, but the end-to-end autonomous decision loop is currently driven via client-side MCP agents (Claude Code, OpenCode).",
    mitigation:
      "Leveraging the open Model Context Protocol (MCP) allows any state-of-the-art LLM client to act as the reasoning engine today."
  }
];

export default function LimitationsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          TRANSPARENCY & CONSTRAINTS
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-[var(--text)] tracking-tight">
          Known Limitations & Failure Modes
        </h1>
        <p className="text-base text-[var(--muted)] max-w-3xl leading-relaxed">
          Honest engineering documentation of current architectural constraints, hardware edge cases, and safety fallbacks.
        </p>
      </section>

      {/* Limitations Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {LIMITATIONS.map((lim, idx) => (
          <div
            key={idx}
            className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-4 shadow-sm flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-[var(--faint)]">{lim.category}</span>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  {lim.impact}
                </span>
              </div>
              <h2 className="text-lg font-bold text-[var(--text)]">{lim.title}</h2>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {lim.description}
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--border)] bg-[var(--card-soft)]/30 -mx-6 -mb-6 p-4 rounded-b-2xl">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                🛡️ Architectural Mitigation:
              </span>
              <p className="text-xs text-[var(--text)] leading-relaxed">
                {lim.mitigation}
              </p>
            </div>
          </div>
        ))}
      </section>

      {/* Fail-Closed Philosophy Card */}
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10 p-6 sm:p-8 space-y-3">
        <h3 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
          <span>🔒</span> The Core Engineering Tenet: Fail-Closed
        </h3>
        <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed max-w-4xl">
          In privacy systems, a false negative (failing to redact a sensitive credit card or password) is catastrophic, whereas a false positive (over-redacting an ambiguous number or falling back to deterministic signals) merely causes a slight visual inconvenience. PerScope is strictly designed to fail-closed across every subsystem.
        </p>
      </section>
    </div>
  );
}
