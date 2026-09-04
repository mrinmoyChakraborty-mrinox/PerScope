import Link from "next/link";

const cards = [
  { href: "/docs/architecture", title: "Locked Architecture (v3)", desc: "Three callers, three extractors, three tiers + required Qwen3 server. Mermaid flowchart + open decisions (Firefox, face)." },
  { href: "/docs/tool-schema", title: "Tool Schema — 7 tools", desc: "Envelope, keepalive, confirm-flow push + MCP gap, WS vs MCP shapes." },
  { href: "/docs/build-order", title: "Build Order (10 steps)", desc: "Time-boxed tracker, MVP re-cut, what to cut first, demo flow." },
  { href: "/docs/security-model", title: "Security Model", desc: "Two boundaries, plan/execute split, uniform validator, fail-closed self-audit." },
  { href: "/tasks", title: "Team Tasks (Person 1–6)", desc: "Lead, Perception (Jeet), Privacy (Koyel), Extension (Shritama), Server/Bridge (Banashree), QA/Pitch (Adreeja)." },
  { href: "/changelog", title: "Changelog", desc: "Document every test, reshape, and architecture tweak — team-editable." },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-[#23233a] bg-gradient-to-br from-[#14141c] to-[#0f0f1a] p-8">
        <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-[#1a1a2a] border border-[#23233a]">SIH26171 · ISRO · Smart Automation · v3</div>
        <h1 className="text-3xl font-black mt-3">PerScope — See everything. Leak nothing.</h1>
        <p className="text-[#b8b8d0] mt-2 max-w-2xl">Local, zero-trust perception + tiered redaction for light-weight browser agents. On-device: DOM Extractor + PaddleOCR + Florence-2 → Tier0 regex/checksum → Tier1 Ettin-68M → Tier2 Qwen 2B → deterministic redaction → self-audit. Server: required Qwen3 Reasoning Server via vLLM/Ollama.</p>
        <div className="flex gap-3 mt-4">
          <Link href="/docs" className="px-4 py-2 rounded-lg bg-[#7c5cff] text-white text-sm">Browse Docs</Link>
          <Link href="/changelog" className="px-4 py-2 rounded-lg border border-[#23233a] text-sm">View Changelog</Link>
          <span className="text-xs text-[#8a8aa0] self-center">Deploy: set Vercel root to <code>docs</code> · Framework: Next.js</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl border border-[#23233a] bg-[#14141c] p-5 hover:border-[#7c5cff]/50 hover:bg-[#1a1a2a] transition">
            <div className="font-semibold">{c.title}</div>
            <div className="text-sm text-[#b8b8d0] mt-1">{c.desc}</div>
            <div className="text-xs text-[#7c5cff] mt-3">Open →</div>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-[#23233a] bg-[#14141c] p-5">
        <div className="font-semibold">How to document while testing</div>
        <ol className="list-decimal pl-5 text-sm text-[#b8b8d0] mt-2 space-y-1">
          <li>Edit any <code>docs/*.md</code> or <code>docs/tasks/*.md</code> — changes appear on next deploy (or <code>npm run dev</code> locally).</li>
          <li>Log every test/reshaping in <Link href="/changelog" className="underline text-[#7c5cff]">Changelog</Link> — use the template in <code>docs/CHANGELOG.md</code> (date, author, area, change, impact).</li>
          <li>Deploy: push to <code>main</code> → Vercel auto-deploys <code>docs/</code>. Or <code>vercel --prod</code> from <code>docs/</code>.</li>
          <li>Share the Vercel URL with judges — they can follow all docs + changelog live.</li>
        </ol>
      </div>
    </div>
  );
}
