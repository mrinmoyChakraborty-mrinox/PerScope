import Link from "next/link";
import { getPinnedTasks } from "@/lib/pinned";

const cards = [
  { href: "/docs/kickoff", title: "Kickoff — What to Add", desc: "Exact files each Person must create. Start here if you join now.", icon: "🚀", accent: "from-[#7c5cff] to-[#00e5a0]" },
  { href: "/docs/architecture", title: "Locked Architecture (v3)", desc: "Three callers, three extractors, three tiers + required Qwen3 server.", icon: "◈", accent: "from-[#7c5cff] to-[#5b8cff]" },
  { href: "/docs/tool-schema", title: "Tool Schema — 7 tools", desc: "Envelope, keepalive, confirm-flow push + MCP gap.", icon: "⚙", accent: "from-[#00e5a0] to-[#7c5cff]" },
  { href: "/docs/build-order", title: "Build Order (10 steps)", desc: "Time-boxed tracker, MVP re-cut, what to cut first.", icon: "▦", accent: "from-[#ff6b6b] to-[#7c5cff]" },
  { href: "/docs/security-model", title: "Security Model", desc: "Two boundaries, plan/execute split, fail-closed self-audit.", icon: "🛡", accent: "from-[#00e5a0] to-[#00d4aa]" },
  { href: "/changelog", title: "Changelog", desc: "Document every test & reshape — team-editable.", icon: "✦", accent: "from-[#7c5cff] to-[#ff6b9d]" },
];

const statusStyle: Record<string, { dot: string; badge: string; border: string }> = {
  urgent: { dot: "bg-[#ff4d4d]", badge: "bg-[#ff4d4d]/15 text-[#ff6b6b] border-[#ff4d4d]/30", border: "border-[#ff4d4d]/30 hover:border-[#ff4d4d]/60" },
  "must-do": { dot: "bg-[#7c5cff]", badge: "bg-[#7c5cff]/15 text-[#a48fff] border-[#7c5cff]/30", border: "border-[#7c5cff]/30 hover:border-[#7c5cff]/60" },
  ongoing: { dot: "bg-[#eab308]", badge: "bg-[#eab308]/15 text-[#facc15] border-[#eab308]/30", border: "border-[#eab308]/30 hover:border-[#eab308]/50" },
  done: { dot: "bg-[#00e5a0]", badge: "bg-[#00e5a0]/12 text-[#7af0c0] border-[#00e5a0]/20", border: "border-[#00e5a0]/20" },
};

export default function Home() {
  const pinned = getPinnedTasks();
  const urgent = pinned.filter((p) => p.status === "urgent");
  const mustDo = pinned.filter((p) => p.status === "must-do");
  const ongoing = pinned.filter((p) => p.status === "ongoing");

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[20px] border border-[#23233a] bg-[#14141c]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#7c5cff]/20 via-transparent to-[#00e5a0]/12" />
        <div className="absolute -top-20 -right-20 w-[420px] h-[420px] bg-[#7c5cff] opacity-[0.08] blur-[70px] rounded-full" />
        <div className="relative p-7 md:p-8">
          <div className="inline-flex items-center gap-2 text-[11px] tracking-wide px-3 py-1.5 rounded-full bg-[#1a1a2a] border border-[#23233a] text-[#b8b8d0]">
            <span className="w-2 h-2 rounded-full bg-[#00e5a0] animate-pulse" /> SIH26171 · ISRO · Smart Automation · <span className="text-white font-semibold">v3</span>
            <span className="hidden sm:inline opacity-60">· Deploy: Vercel root <code className="px-1 py-0.5 rounded bg-[#0a0a0f] border border-[#23233a]">docs</code></span>
          </div>
          <h1 className="text-[28px] md:text-[34px] font-black tracking-tight mt-4 leading-tight">
            PerScope — <span className="bg-gradient-to-r from-[#cbb8ff] to-[#7c5cff] bg-clip-text text-transparent">See everything.</span> Leak nothing.
          </h1>
          <p className="text-[#b8b8d0] mt-3 max-w-2xl text-[14px] leading-relaxed">
            Local, zero-trust perception + tiered redaction for light-weight browser agents. On-device{" "}
            <span className="text-white">DOM Extractor + PaddleOCR + Florence-2</span> → Tier0 regex/checksum → Tier1 Ettin-68M → Tier2 Qwen 2B → deterministic redaction → self-audit. Server: <span className="text-white">required Qwen3 Reasoning Server</span> via vLLM/Ollama.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Link href="/docs" className="px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-zinc-100 transition">
              Browse Docs
            </Link>
            <Link href="/changelog" className="px-5 py-2.5 rounded-full border border-[#23233a] bg-[#0a0a0f]/60 text-sm hover:bg-[#1a1a2a] transition">
              View Changelog
            </Link>
            <Link href="/docs/kickoff" className="px-5 py-2.5 rounded-full bg-[#7c5cff] text-white text-sm font-semibold hover:bg-[#6b4de6] transition">
              Kickoff →
            </Link>
          </div>
          <div className="flex gap-2 mt-4 text-[11px] text-[#8a8aa0]">
            <span className="px-2 py-1 rounded-full border border-[#23233a] bg-[#0a0a0f]">7 tools · keepalive</span>
            <span className="px-2 py-1 rounded-full border border-[#23233a] bg-[#0a0a0f]">Fail-closed</span>
            <span className="px-2 py-1 rounded-full border border-[#23233a] bg-[#0a0a0f] hidden sm:inline">Chrome 116+</span>
          </div>
        </div>
      </div>

      {/* Pinned — Urgent / Must-Do / Ongoing */}
      <div className="rounded-[16px] border border-[#ff4d4d]/20 bg-gradient-to-br from-[#1a1214] to-[#14141c] overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-[#23233a] bg-[#0f0f14]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-[#ff4d4d]/15 border border-[#ff4d4d]/30 grid place-items-center text-[14px]">📌</span>
            <div>
              <div className="font-bold text-sm flex items-center gap-2">Urgent — Must do · Ongoing <span className="w-2 h-2 rounded-full bg-[#ff4d4d] animate-pulse" /></div>
              <div className="text-xs text-[#8a8aa0]">Pinned from <code className="px-1 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a] text-[11px]">docs/data/pinned.json</code> — edit, push, auto-redeploys. Shows on home only.</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            <span className="px-2 py-1 rounded-full bg-[#ff4d4d]/15 border border-[#ff4d4d]/30 text-[#ff8a8a]">{urgent.length} urgent</span>
            <span className="px-2 py-1 rounded-full bg-[#7c5cff]/15 border border-[#7c5cff]/30 text-[#a48fff]">{mustDo.length} must-do</span>
            <span className="px-2 py-1 rounded-full bg-[#eab308]/15 border border-[#eab308]/30 text-[#facc15]">{ongoing.length} ongoing</span>
          </div>
        </div>

        <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {pinned.map((t) => {
            const s = statusStyle[t.status] ?? statusStyle.ongoing;
            return (
              <Link
                key={t.id}
                href={t.link ?? "/docs/kickoff"}
                className={`group rounded-xl border bg-[#0f0f14] p-4 card-hover shine ${s.border}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold ${s.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {t.status}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-[#1a1a2a] border border-[#23233a] text-[#8a8aa0]">{t.priority} · {t.area}</span>
                </div>
                <div className="font-semibold text-sm mt-3 leading-snug group-hover:text-white transition">{t.title}</div>
                <div className="text-xs text-[#b8b8d0] mt-1 line-clamp-2">{t.description}</div>
                <div className="flex items-center justify-between mt-3 text-[11px] text-[#8a8aa0]">
                  <span>{t.owner}</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">due {t.due ?? "—"}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="px-4 py-3 bg-[#0a0a0f]/50 border-t border-[#23233a] flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#8a8aa0]">To pin/unpin: edit <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/data/pinned.json</code> (push → live). Remove an entry to unpin; add <code>status:"done"</code> to archive.</span>
          <Link href="/docs/kickoff" className="px-3 py-1.5 rounded-full bg-[#7c5cff] text-white font-medium hover:bg-[#6b4de6] transition">Open Kickoff →</Link>
        </div>
      </div>

      {/* Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group relative rounded-2xl border border-[#23233a] bg-[#14141c] p-5 overflow-hidden card-hover shine"
          >
            <div className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${c.accent}`} />
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-[#1a1a2a] border border-[#23233a] grid place-items-center text-sm">{c.icon}</div>
              <div className="font-bold text-sm mt-3">{c.title}</div>
              <div className="text-[13px] text-[#b8b8d0] mt-1 leading-snug">{c.desc}</div>
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#7c5cff] mt-3 group-hover:gap-2 transition-all">Open <span>→</span></div>
            </div>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-[#23233a] bg-[#14141c] p-5">
        <div className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-[#7c5cff]/15 border border-[#7c5cff]/30 grid place-items-center text-xs">✦</span> How to document while testing</div>
        <ol className="list-decimal pl-5 text-sm text-[#b8b8d0] mt-3 space-y-1.5">
          <li>Edit any <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/*.md</code> or <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/tasks/*.md</code> — changes appear on next deploy (or <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">npm run dev</code>).</li>
          <li>Pin urgent work in <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/data/pinned.json</code> — appears in the pinned section above.</li>
          <li>Log every reshape in <Link href="/changelog" className="underline decoration-[#7c5cff]/50 text-[#a48fff]">Changelog</Link> via <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/CHANGELOG.md</code>.</li>
          <li>Push to <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">main</code> → Vercel auto-deploys <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/</code>. Share the Vercel URL with judges.</li>
        </ol>
      </div>
    </div>
  );
}
