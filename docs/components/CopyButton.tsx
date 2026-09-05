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
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
        copied
          ? "bg-[#00e5a0] text-black border-[#00e5a0]"
          : "bg-[#1a1a2a] text-[#b8b8d0] border-[#23233a] hover:bg-[#23233a] hover:text-white"
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
      className="px-2 py-1 rounded-md bg-[#0a0a0f] border border-[#23233a] text-[11px] text-[#8a8aa0] hover:text-white hover:border-[#7c5cff]/50 transition"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}
