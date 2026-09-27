import { ModeExplorer } from "@/components/ModeExplorer";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
  title: "PerScope — User Flows & Operating Modes | SIH26171",
  description:
    "Comprehensive guide to PerScope user flows across Human Mode, Bridge Mode, different real-world situations, and user personas.",
};

const USER_PERSONAS = [
  {
    role: "Privacy-Conscious Web User",
    icon: "🛡️",
    badge: "HUMAN MODE",
    badgeColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    goal: "Share browser screenshots with customer support, family, or online forums without exposing bank account details, addresses, or phone numbers.",
    flow: "Opens extension popup → clicks 'Capture Visible Tab' or pastes screenshot → WebGPU redacts PII in 200ms → downloads sanitized PNG.",
    keyBenefit: "Zero sensitive pixel leakage; no manual editing in Photoshop needed."
  },
  {
    role: "Student & Academic Researcher",
    icon: "🎓",
    badge: "HUMAN MODE",
    badgeColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    goal: "Submit academic portals, grant forms, or confidential PDF previews to AI summarizers without leaking roll numbers or private draft notes.",
    flow: "Clicks 'Capture DOM Text' → DOM walker extracts structured blocks, filters secrets, redacts PII → exports safe sanitized text document.",
    keyBenefit: "Live webpage is never mutated; raw tokens zeroed in memory immediately."
  },
  {
    role: "Enterprise & Security Reviewer",
    icon: "🔍",
    badge: "AUDIT MODE",
    badgeColor: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    goal: "Verify zero-trust compliance, ensure no cloud data leaks exist, and inspect exact machine telemetry and model bounding boxes.",
    flow: "Loads extension dashboard → inspects compute telemetry (WebGPU adapter, execution time) → downloads structured JSON evidence object.",
    keyBenefit: "Tamper-evident audit trail with zero unmasked PII strings in telemetry."
  },
  {
    role: "Autonomous Agent Developer",
    icon: "🤖",
    badge: "BRIDGE MODE (MCP)",
    badgeColor: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    goal: "Build autonomous browser-driving agents (Claude Code, OpenCode) that navigate web portals safely without seeing user credentials.",
    flow: "Connects agent to @perscope/bridge MCP → agent invokes capture_tab → bridge relays to extension → extension returns sanitized screen.",
    keyBenefit: "Hardware-enforced trust boundary prevents agent from ever seeing raw PII."
  },
  {
    role: "SIH Hackathon Judge",
    icon: "⚡",
    badge: "JUDGE MODE",
    badgeColor: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
    goal: "Evaluate architectural novelty, edge AI feasibility on commodity GPUs, and verify that claimed capabilities match repo code.",
    flow: "Visits /judge → reviews 90-second executive summary → inspects live perception simulator → verifies Tested vs Planned matrix.",
    keyBenefit: "Immediate technical clarity backed by verified disk files and test suites."
  }
];

const SITUATION_SCENARIOS = [
  {
    title: "Scenario 1: Online Checkout & Billing Screen",
    situation: "User is purchasing equipment or flight tickets and needs an AI agent to help find promo codes or verify cancellation policies.",
    problem: "The checkout page displays customer full name, delivery address, credit card number, expiration, and CVV.",
    perscopeAction: "Value-Only Redaction calculates sub-boxes for the 16-digit card and CVV. Labels like 'Card Number:' and 'Promo Code' remain visible so the agent can find the coupon input box without seeing payment credentials."
  },
  {
    title: "Scenario 2: Healthcare & Patient Portal",
    situation: "Patient is looking at laboratory test results and wants an AI assistant to explain medical terminology.",
    problem: "Page contains national identity number, date of birth, doctor names, and confidential diagnostic notes.",
    perscopeAction: "Ettin-68M NER and regex heuristics detect personal names, dates of birth, and identity codes. Biometric avatar photo is blurred by BlazeFace. Only the sanitized medical description passes to the AI."
  },
  {
    title: "Scenario 3: Autonomous Web Automation (Flight Booking)",
    situation: "Agent is searching for flights and clicks through date pickers and seat maps via Bridge Mode.",
    problem: "Agent reaches the final booking stage and tries to click 'Confirm Purchase' with a stored corporate credit card.",
    perscopeAction: "The tool call `click('#confirm-pay')` is intercepted by `is-destructive.js`. Action halts immediately and enters `WAITING_FOR_HUMAN_APPROVAL` state, prompting the user in the extension UI to approve or deny."
  },
  {
    title: "Scenario 4: High-Performance GPU vs Resource-Constrained Laptop",
    situation: "A developer on an RTX 4070 runs PerScope; simultaneously, a student on an older dual-core laptop without WebGPU opens the page.",
    problem: "Heavy multimodal models could crash low-end machines or fail when WebGPU adapter is unavailable.",
    perscopeAction: "PerScope's `gpu.js` module dynamically queries adapter capabilities. High-end devices pin WebGPU for 200ms latency; constrained devices automatically fall back to single-threaded WASM SIMD, guaranteeing functionality."
  }
];

export default function UserFlowsPage() {
  return (
    <div className="space-y-12">
      {/* Page Header */}
      <section className="space-y-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          OPERATIONAL DYNAMICS
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-[var(--text)] tracking-tight">
          User Flows Across Modes & Situations
        </h1>
        <p className="text-base text-[var(--muted)] max-w-3xl leading-relaxed">
          How PerScope seamlessly shifts behavior depending on whether it is operated by an interactive human or an autonomous AI agent, adapting dynamically across distinct security contexts.
        </p>
      </section>

      {/* Interactive Mode Explorer (Human vs Bridge) */}
      <section>
        <ModeExplorer />
      </section>

      {/* User Personas Grid */}
      <section className="space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            5 TARGET PERSONAS
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            How PerScope Serves Different Users
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Real-world personas with tailored workflows and security guarantees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {USER_PERSONAS.map((persona, idx) => (
            <div
              key={idx}
              className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-4 shadow-sm flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{persona.icon}</span>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${persona.badgeColor}`}>
                    {persona.badge}
                  </span>
                </div>
                <h3 className="text-base font-bold text-[var(--text)]">{persona.role}</h3>
                <div className="text-xs text-[var(--muted)] leading-relaxed">
                  <strong className="text-[var(--text)]">Objective: </strong>
                  {persona.goal}
                </div>
                <div className="text-xs text-[var(--faint)] font-mono bg-[var(--bg-soft)] p-2.5 rounded-lg border border-[var(--border)]">
                  <strong className="text-[var(--text)] font-sans">Workflow: </strong>
                  {persona.flow}
                </div>
              </div>
              <div className="pt-3 border-t border-[var(--border)] text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                ✓ {persona.keyBenefit}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Situational Context Scenarios */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            REAL-WORLD SCENARIOS
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            How PerScope Varies with Different Situations
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Examining edge cases, high-risk pages, and adaptive runtime adjustments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SITUATION_SCENARIOS.map((scen, idx) => (
            <div
              key={idx}
              className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/40 space-y-3"
            >
              <h3 className="text-sm font-bold text-[var(--text)]">{scen.title}</h3>
              <div className="text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">Context: </span>
                {scen.situation}
              </div>
              <div className="text-xs text-red-600 dark:text-red-400">
                <span className="font-semibold">Vulnerability: </span>
                {scen.problem}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
                <span className="font-bold">PerScope Mitigation: </span>
                {scen.perscopeAction}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deep Dive into DOM Snapshot Walker */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            DOM ENGINE INTERNALS
          </span>
          <h2 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
            The Non-Mutating DOM Snapshot Pipeline
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Built in <code>src/pipeline/dom-capture.js</code> and passing 11/11 unit tests.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)]">1. Deep Shadow DOM Traversal</div>
            <p className="text-[var(--muted)] leading-relaxed">
              Recursively descends into <code>open</code> shadow roots. Closed shadow roots cannot be accessed without browser privileges, so they are explicitly counted in <code>skipped.shadowRootsClosed</code> rather than silently omitted.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)]">2. Cross-Origin Iframe Collection</div>
            <p className="text-[var(--muted)] leading-relaxed">
              Same-origin iframes are read directly. Cross-origin iframes communicate via an internal <code>window.postMessage</code> protocol with a 900ms timeout. Unreachable iframes are counted in <code>skipped.iframesCrossOriginUnreachable</code>.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)]">3. Zero-Raw Memory Hygiene</div>
            <p className="text-[var(--muted)] leading-relaxed">
              Password fields (<code>type=password</code>) and secrets automatically trigger <code>forceRedact</code> with confidence 1.0. Raw strings and DOM selector paths are zeroed out before output is returned to the caller.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
