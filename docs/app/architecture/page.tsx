import { InteractivePipeline } from "@/components/InteractivePipeline";
import { TrustBoundaryDiagram } from "@/components/TrustBoundaryDiagram";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
  title: "PerScope — System Architecture & Internals | SIH26171",
  description:
    "Comprehensive technical architecture documentation of PerScope: Chrome MV3 extension contexts, WebGPU model runtime, and safety gates.",
};

const EXTENSION_COMPONENTS = [
  {
    name: "Popup UI",
    file: "extension/v7 beta/src/popup/popup.js",
    lines: "524 lines",
    role: "User-facing extension action",
    description:
      "Handles drag-and-drop, tab capture triggers, image preview toggling (original vs redacted vs overlay), DOM capture trigger, and PII chips rendering. Zero npm dependencies (pure DOM)."
  },
  {
    name: "Background Worker",
    file: "extension/v7 beta/src/background/service-worker.js",
    lines: "165 lines",
    role: "MV3 Service Worker",
    description:
      "Manages extension lifecycle, creates the offscreen document via ensureOffscreenDocument, relays CAPTURE_VISIBLE_TAB, updates bridge badge color, and forwards DOM capture requests."
  },
  {
    name: "Offscreen Document",
    file: "extension/v7 beta/src/offscreen/offscreen.js",
    lines: "191 lines",
    role: "Isolated WebGPU & ML Host",
    description:
      "Hosts WebGPU/WASM runtime and models. Runs the entire 10-stage image perception pipeline. Houses bridge-link.js for persistent WebSocket connection to @perscope/bridge."
  },
  {
    name: "Bridge Link",
    file: "extension/v7 beta/src/offscreen/bridge-link.js",
    lines: "260 lines",
    role: "WebSocket Client to MCP Bridge",
    description:
      "Connects to ws://127.0.0.1:7331. Handles 6-digit pair/hello authentication handshake, automatic reconnection with exponential backoff, and tool execution dispatch."
  },
  {
    name: "Content Script",
    file: "extension/v7 beta/src/content/dom-capture-entry.js",
    lines: "225 lines",
    role: "Non-Mutating DOM Ingestion",
    description:
      "Triggered solely on-demand via chrome.tabs.sendMessage. Recursively traverses text, form inputs, open shadow roots, and cross-origin iframes. Never mutates live page elements."
  },
  {
    name: "Full Dashboard",
    file: "extension/v7 beta/src/app/dashboard.js",
    lines: "330 lines",
    role: "Options & Telemetry Page",
    description:
      "Full-tab inspection interface showing hardware telemetry (WebGPU adapter, GPU tier), pipeline toggles (FastVLM, BlazeFace), and pairing input for @perscope/bridge."
  }
];

export default function ArchitecturePage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          TECHNICAL BLUEPRINT
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-[var(--text)] tracking-tight">
          System Architecture & Internals
        </h1>
        <p className="text-base text-[var(--muted)] max-w-3xl leading-relaxed">
          How PerScope achieves sub-250ms on-device perception, zero-trust sanitization, and fail-closed safety gating inside a Chrome Manifest V3 extension.
        </p>
      </section>

      {/* Extension Contexts Grid */}
      <section className="space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            CHROME MV3 CONTEXT MAP
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Extension Execution Contexts
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Verified responsibilities and file mappings from <code>extension/v7 beta/src/</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {EXTENSION_COMPONENTS.map((comp, idx) => (
            <div
              key={idx}
              className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-3 shadow-sm flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-[var(--text)]">{comp.name}</h3>
                  <span className="text-[10px] font-mono text-[var(--faint)]">{comp.lines}</span>
                </div>
                <div className="text-[11px] font-mono text-[var(--accent)] font-semibold">
                  {comp.role}
                </div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  {comp.description}
                </p>
              </div>
              <div className="pt-2 border-t border-[var(--border)]">
                <code className="text-[10px] font-mono text-[var(--faint)] block truncate">
                  {comp.file}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive 10-Stage Pipeline */}
      <section>
        <InteractivePipeline />
      </section>

      {/* Trust Boundary Diagram */}
      <section>
        <TrustBoundaryDiagram />
      </section>

      {/* Value-Only Geometry Explanation */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            SURGICAL LOCALIZATION
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            Value-Only Geometry Resolution: Preserving UI Labels
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Why traditional black-box redactors break AI agents, and how PerScope solves it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 text-xs text-[var(--muted)] leading-relaxed">
            <p>
              If a browser redactor masks an entire OCR line, such as <code>&ldquo;Credit Card Number: 4532 8812 0019 3321&rdquo;</code>, an autonomous agent can no longer recognize that the input field on screen is a credit card input. It breaks the agent&rsquo;s ability to complete forms.
            </p>
            <p>
              PerScope implements <strong className="text-[var(--text)]">Value-Only Geometry Resolution</strong> in <code>src/pipeline/heuristics.js</code>:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-[var(--text)]">
              <li>
                <strong>Label Matching:</strong> Identifies preceding field labels (e.g. &ldquo;Card Number:&rdquo;, &ldquo;CVV:&rdquo;, &ldquo;Exp:&rdquo;, &ldquo;SSN:&rdquo;).
              </li>
              <li>
                <strong>Substring Offset Calculation:</strong> Computes the exact character index where the sensitive value begins and ends.
              </li>
              <li>
                <strong>Proportional Sub-Box Estimation:</strong> Calculates normalized horizontal slices <code>[xmin, xmax]</code> covering ONLY the sensitive value digits.
              </li>
              <li>
                <strong>Conservative Reject Path:</strong> If character geometry cannot be determined with mathematical certainty, it safely redacts the entire box rather than risking a leak.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--code-bg)] p-4 space-y-3">
            <div className="text-xs font-mono font-bold text-[var(--prose-code)]">
              // Mathematical sub-box derivation (heuristics.js)
            </div>
            <CodeBlock
              language="javascript"
              title="resolveSensitiveValueBBox() logic"
              code={`// Calculate character-width proportional sub-box
const startRatio = match.index / fullText.length;
const endRatio = (match.index + match.length) / fullText.length;

const subBox = [
  parentBox[0], // ymin stays unchanged
  parentBox[1] + (parentBox[3] - parentBox[1]) * startRatio, // xmin
  parentBox[2], // ymax stays unchanged
  parentBox[1] + (parentBox[3] - parentBox[1]) * endRatio   // xmax
];`}
            />
          </div>
        </div>
      </section>

      {/* Safety Gates & Fail-Closed Behavior */}
      <section className="rounded-2xl border border-amber-500/20 bg-amber-50/20 dark:bg-amber-950/10 p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🛡️</span>
          <h3 className="text-xl font-bold text-[var(--text)]">
            Fail-Closed Safety Gate: Why FastVLM is Never Blindly Trusted
          </h3>
        </div>
        <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
          Large multimodal models frequently hallucinate or emit truncated JSON when processing complex web pages. In PerScope, FastVLM proposals pass through strict deterministic validation in <code>safety.js</code>:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
          <div className="p-3.5 rounded-lg border border-amber-500/20 bg-[var(--card)] space-y-1">
            <span className="font-bold text-[var(--text)]">1. Candidate Verification</span>
            <p className="text-[var(--muted)]">Every proposed redaction must match a real candidate ID generated by OCR or Ettin NER.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-amber-500/20 bg-[var(--card)] space-y-1">
            <span className="font-bold text-[var(--text)]">2. Type Whitelist Check</span>
            <p className="text-[var(--muted)]">Types must exist in <code>ALLOWED_FASTVLM_TYPES</code> (person, credit_card, ssn, email, phone, etc.).</p>
          </div>
          <div className="p-3.5 rounded-lg border border-amber-500/20 bg-[var(--card)] space-y-1">
            <span className="font-bold text-[var(--text)]">3. fusion_fallback Trigger</span>
            <p className="text-[var(--muted)]">If JSON parsing fails or proposal count is zero, pipeline automatically falls back to deterministic signals.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
