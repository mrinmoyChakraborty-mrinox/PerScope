"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy MD" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition shadow-sm ${
        copied
          ? "bg-[#2563eb] dark:bg-[#00e5a0] text-white dark:text-black border-[#2563eb] dark:border-[#00e5a0]"
          : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-soft)] hover:text-[var(--text)]"
      }`}
      title="Copy raw markdown to clipboard"
    >
      <span className="text-[11px]">{copied ? "✓ Copied" : `⎘ ${label}`}</span>
    </button>
  );
}

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="px-2 py-1 rounded-md bg-[var(--code-bg)] border border-[var(--code-border)] text-[11px] text-[var(--faint)] hover:text-[var(--text)] hover:border-[var(--accent)]/40 transition"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}
