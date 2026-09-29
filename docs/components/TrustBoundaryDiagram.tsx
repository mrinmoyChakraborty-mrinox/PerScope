"use client";

export function TrustBoundaryDiagram() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg my-8">
      {/* Header */}
      <div className="p-6 border-b border-[var(--border)] bg-gradient-to-r from-[var(--card)] via-[var(--card-soft)] to-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              SECURITY INVARIANT · ZERO-TRUST
            </span>
            <h3 className="text-2xl font-black mt-2 text-[var(--text)] tracking-tight">
              The Hardware-Enforced Trust Boundary
            </h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              Clear mathematical separation between on-device user context and untrusted external entities.
            </p>
          </div>
          <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold">
            🔒 TESTED FLOW: 0 CLOUD CALLS
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8 space-y-8">
        {/* Visual Boundary Architecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
          {/* Left: The Local Enclave */}
          <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10 p-6 space-y-5 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  On-Device Boundary (Stays Local)
                </span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold">
                PROTECTED ENCLAVE
              </span>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>📸</span> Raw Viewport Pixels & Screen Buffers
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Uncompressed RGBA canvas pixels, full browser window, background tabs, and private window contents never leave browser process memory.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>👤</span> Biometric Faces & Portrait Photos
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Detected by BlazeFace ONNX on-device; bounding boxes are blurred directly on canvas before any export.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>💳</span> Unmasked Sensitive PII & Credentials
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Credit cards, bank account numbers, passwords, session tokens, personal names, phone numbers, and SSNs.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>🧠</span> On-Device Neural Model Weights
                </div>
                <p className="text-xs text-[var(--muted)]">
                  BlazeFace, PaddleOCR, Ettin-68M, and FastVLM-0.5B execute locally inside Chrome MV3 Offscreen WebGPU/WASM environment.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Across the Boundary */}
          <div className="rounded-2xl border-2 border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/10 p-6 space-y-5 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  External Trust Boundary (Exposed)
                </span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-300 font-bold">
                SANITIZED ONLY
              </span>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-blue-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>🖼️</span> Value-Only Redacted Image
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Bitmap where sensitive sub-boxes are physically obscured with Gaussian blur or opaque solid rectangles. Surrounding UI layout is preserved.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-blue-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>🏷️</span> Visible Field Labels & UI Structure
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Labels like "Card Number:", "Billing Address:", "Account ID:" remain readable so AI agents know what fields exist on the page.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-blue-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>💬</span> Scrubbed Visual Captions
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Visual captions where any detected value has been deterministically replaced with <code>[REDACTED:TYPE]</code> placeholders.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-blue-500/20 bg-[var(--card)] space-y-1">
                <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                  <span>📋</span> Tamper-Evident Evidence Object
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Metadata stating what categories of PII were redacted, confidence scores, bounding coordinates, and compute device telemetry.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Table: Stays Local vs Crosses Boundary */}
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="bg-[var(--card-soft)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--text)] border-b border-[var(--border)]">
            Exact Data Artifact Separation Matrix
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-soft)] text-[var(--muted)] border-b border-[var(--border)] font-semibold">
                <tr>
                  <th className="p-3">Data Element</th>
                  <th className="p-3">Stays Local (Device)</th>
                  <th className="p-3">Crosses Boundary (Agent/Cloud)</th>
                  <th className="p-3">Guaranteed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[var(--text)]">
                <tr>
                  <td className="p-3 font-semibold">Raw Unredacted Pixels</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">YES (Kept in Offscreen)</td>
                  <td className="p-3 text-red-600 dark:text-red-400 font-bold">NEVER</td>
                  <td className="p-3 font-mono text-[11px] text-[var(--faint)]">canvas-redactor.js</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold">Credit Card / CVV / SSN Values</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">YES</td>
                  <td className="p-3 text-red-600 dark:text-red-400 font-bold">NEVER (Zeroed out)</td>
                  <td className="p-3 font-mono text-[11px] text-[var(--faint)]">heuristics.js + Luhn check</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold">Field Labels ("Card Number:")</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400">YES</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">YES (Preserved for agent context)</td>
                  <td className="p-3 font-mono text-[11px] text-[var(--faint)]">resolveSensitiveValueBBox()</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold">Face Images / Avatars</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">YES</td>
                  <td className="p-3 text-red-600 dark:text-red-400 font-bold">NEVER (Blurred on Canvas)</td>
                  <td className="p-3 font-mono text-[11px] text-[var(--faint)]">face.js (BlazeFace)</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold">Redaction Telemetry & Evidence</td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400">YES</td>
                  <td className="p-3 text-blue-600 dark:text-blue-400 font-bold">YES (Without raw sensitive strings)</td>
                  <td className="p-3 font-mono text-[11px] text-[var(--faint)]">v7-extension.js</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
