"use client";
import { useEffect, useId, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(`perscope-mmd-${id}`, chart);
        if (!cancelled) setSvg(svg);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Mermaid render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
        <div className="text-xs font-semibold text-red-500 mb-2">Diagram failed to render — showing source:</div>
        <pre className="text-xs overflow-x-auto whitespace-pre">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card-soft)] p-6 text-xs text-[var(--faint)] animate-pulse">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="mermaid-block rounded-xl border border-[var(--border)] bg-white dark:bg-[#14141c] p-4 overflow-x-auto [&>svg]:max-w-full [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
