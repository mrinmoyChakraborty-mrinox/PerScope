"use client";

import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export function CodeBlock({ code, language = "bash", title }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[#0f111a] text-zinc-100 overflow-hidden shadow-md my-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-[#161824] text-xs font-mono text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          {title && <span className="ml-2 font-medium text-zinc-300">{title}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">{language}</span>
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 transition flex items-center gap-1"
          >
            {copied ? (
              <>
                <span className="text-emerald-400">✓</span> Copied
              </>
            ) : (
              <>
                <span>📋</span> Copy
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="p-4 text-xs md:text-sm font-mono overflow-x-auto leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
