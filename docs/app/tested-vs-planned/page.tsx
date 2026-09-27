import { CapabilityMatrix } from "@/components/CapabilityMatrix";

export const metadata = {
  title: "PerScope — Tested vs Planned Capability Matrix | SIH26171",
  description:
    "Comprehensive audit of PerScope capabilities distinguishing tested ground truth from roadmap features with source file evidence.",
};

export default function TestedVsPlannedPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          RIGOR & HONESTY
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-[var(--text)] tracking-tight">
          Tested Ground Truth vs Planned Features
        </h1>
        <p className="text-base text-[var(--muted)] max-w-3xl leading-relaxed">
          We explicitly distinguish what is tested and running on disk today from what remains on our planned architectural roadmap. Every entry cites actual repository evidence files.
        </p>
      </section>

      {/* Main Capability Matrix Component */}
      <section>
        <CapabilityMatrix />
      </section>

      {/* Repository Ground Truth Notes */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">
            Engineering Verification Summary
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Key findings from the repository audit documented in <code>ARCHITECTURE_SNAPSHOT.md</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-[var(--muted)] leading-relaxed">
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)] text-sm">
              ✅ The Active Extension is extension/v7 beta/
            </div>
            <p>
              Top-level stub files (such as <code>extension/background/background.js</code> and <code>extension/manifest.json</code>) are legacy placeholders. The active, fully-bundled extension lives in <code>extension/v7 beta/</code> with its own <code>manifest.json</code>, esbuild bundler, and pipeline modules.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)] text-sm">
              ✅ DOM Snapshotting is Met & Tested
            </div>
            <p>
              While older README drafts marked DOM capture as &ldquo;not started&rdquo;, the code on disk in <code>src/pipeline/dom-capture.js</code> and <code>dom-heuristics.js</code> is fully functional and passes 11/11 automated unit tests in <code>tests/dom-capture.test.mjs</code>.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)] text-sm">
              🔵 Destructive Action Classification vs Execution
            </div>
            <p>
              The <code>isDestructive()</code> classifier is implemented and unit tested in <code>src/shared/is-destructive.js</code>. However, live execution of interactive actions (click/type/submit) inside the active browser returns <code>dom-not-implemented-in-beta</code>, as full DOM action replay is deferred to the final release.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-2">
            <div className="font-bold text-[var(--text)] text-sm">
              🔒 100% On-Device Ingestion Guarantee
            </div>
            <p>
              The tested perception pipeline (BlazeFace, PaddleOCR, Ettin-68M, FastVLM) runs locally in the Chrome offscreen document via WebGPU and WASM SIMD. It makes zero outbound cloud calls during screen analysis and redaction.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
