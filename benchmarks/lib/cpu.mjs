/* PerScope benchmark harness - CPU sampling (Node builtins only).
   Measures CPU *seconds consumed by Chrome processes* across each capture,
   so runs can be compared by burn, not just wall time. Wall time per stage
   (already recorded) says WHERE time goes; CPU seconds say WHAT burns.
   Per-stage CPU attribution is impossible from outside the renderer, and
   this module does not pretend otherwise - CPU is per-RUN, stages are
   per-STAGE, and the report keeps them in separate tables.
   Windows-only for now (Get-Process CPU = TotalProcessorTime in seconds);
   other platforms return null and the report marks CPU "n/a". */

import { execFile } from "node:child_process";

function execFileAsync(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    child.on("error", reject);
  });
}

/** Total CPU seconds across all chrome.exe processes, or null. */
export async function sampleChromeCpuSeconds(timeoutMs = 10_000) {
  if (process.platform !== "win32") return null;
  try {
    const out = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum"],
      timeoutMs,
    );
    const v = parseFloat(String(out).trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
