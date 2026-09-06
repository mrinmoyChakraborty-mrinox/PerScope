import Link from "next/link";
import { getPinnedTasks } from "@/lib/pinned";

const cards = [
  { href: "/docs/kickoff", title: "Kickoff — What to Add", desc: "Exact files each Person must create. Start here if you join now.", icon: "🚀", accent: "from-[#2563eb] to-[#06b6d4] dark:from-[#7c5cff] dark:to-[#00e5a0]" },
  { href: "/docs/architecture", title: "Locked Architecture (v3)", desc: "Three callers, three extractors, three tiers + required Qwen3 server.", icon: "◈", accent: "from-[#2563eb] to-[#3b82f6] dark:from-[#7c5cff] dark:to-[#5b8cff]" },
  { href: "/docs/tool-schema", title: "Tool Schema — 7 tools", desc: "Envelope, keepalive, confirm-flow push + MCP gap.", icon: "⚙", accent: "from-[#0ea5e9] to-[#2563eb] dark:from-[#00e5a0] dark:to-[#7c5cff]" },
  { href: "/docs/build-order", title: "Build Order (10 steps)", desc: "Time-boxed tracker, MVP re-cut, what to cut first.", icon: "▦", accent: "from-[#f43f5e] to-[#2563eb] dark:from-[#ff6b6b] dark:to-[#7c5cff]" },
  { href: "/docs/security-model", title: "Security Model", desc: "Two boundaries, plan/execute split, fail-closed self-audit.", icon: "🛡", accent: "from-[#0ea5e9] to-[#10b981] dark:from-[#00e5a0] dark:to-[#00d4aa]" },
  { href: "/changelog", title: "Changelog", desc: "Document every test & reshape — team-editable.", icon: "✦", accent: "from-[#2563eb] to-[#ec4899] dark:from-[#7c5cff] dark:to-[#ff6b9d]" },
];

const statusStyle: Record<string, { dot: string; badge: string; border: string }> = {
  urgent: { dot: "bg-[#ef4444] dark:bg-[#ff4d4d]", badge: "bg-[#fef2f2] text-[#dc2626] border-[#fecaca] dark:bg-[#ff4d4d]/15 dark:text-[#ff8a8a] dark:border-[#ff4d4d]/30", border: "border-[#fecaca] hover:border-[#fca5a5] dark:border-[#ff4d4d]/30 dark:hover:border-[#ff4d4d]/60" },
  "must-do": { dot: "bg-[#2563eb] dark:bg-[#7c5cff]", badge: "bg-[#eff6ff] text-[#1d4ed8] border-[#bfdbfe] dark:bg-[#7c5cff]/15 dark:text-[#a48fff] dark:border-[#7c5cff]/30", border: "border-[#bfdbfe] hover:border-[#93c5fd] dark:border-[#7c5cff]/30 dark:hover:border-[#7c5cff]/60" },
  ongoing: { dot: "bg-[#eab308] dark:bg-[#eab308]", badge: "bg-[#fefce8] text-[#a16207] border-[#fde68a] dark:bg-[#eab308]/15 dark:text-[#facc15] dark:border-[#eab308]/30", border: "border-[#fde68a] hover:border-[#fcd34d] dark:border-[#eab308]/30 dark:hover:border-[#eab308]/50" },
  done: { dot: "bg-[#10b981] dark:bg-[#00e5a0]", badge: "bg-[#ecfdf5] text-[#047857] border-[#a7f3d0] dark:bg-[#00e5a0]/12 dark:text-[#7af0c0] dark:border-[#00e5a0]/20", border: "border-[#a7f3d0] dark:border-[#00e5a0]/20" },
};

export default function Home() {
  const pinned = getPinnedTasks();
  const urgent = pinned.filter((p) => p.status === "urgent");
  const mustDo = pinned.filter((p) => p.status === "must-do");
  const ongoing = pinned.filter((p) => p.status === "ongoing");

  return (
    <div className="space-y-8">
      {/* Hero — white-blue in light, dark gradient in dark */}
      <div className="relative overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--card)] shadow-sm dark:shadow-none">
        <div className="absolute inset-0 bg-gradient-to-br from-[#eff6ff] via-transparent to-[#f0fdfa] dark:from-[#7c5cff]/20 dark:via-transparent dark:to-[#00e5a0]/12" />
        <div className="absolute -top-20 -right-20 w-[420px] h-[420px] bg-[#3b82f6] opacity-[0.07] blur-[70px] rounded-full dark:bg-[#7c5cff] dark:opacity-[0.08]" />
        <div className="absolute -bottom-10 -left-20 w-[380px] h-[280px] bg-[#06b6d4] opacity-[0.05] blur-[60px] rounded-full dark:bg-[#00e5a0] dark:opacity-[0.06]" />
        <div className="relative p-7 md:p-8">
          <div className="inline-flex items-center gap-2 text-[11px] tracking-wide px-3 py-1.5 rounded-full bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">
            <span className="w-2 h-2 rounded-full bg-[#10b981] dark:bg-[#00e5a0] animate-pulse" /> SIH26171 · ISRO · Smart Automation · <span className="text-[var(--text)] font-semibold">v3</span>
            <span className="hidden sm:inline opacity-60">· Deploy: Vercel root <code className="px-1 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs</code></span>
          </div>
          <h1 className="text-[28px] md:text-[36px] font-black tracking-tight mt-4 leading-[1.1]">
            PerScope — <span className="bg-gradient-to-r from-[#2563eb] to-[#06b6d4] dark:from-[#cbb8ff] dark:to-[#7c5cff] bg-clip-text text-transparent">See everything.</span> Leak nothing.
          </h1>
          <p className="text-[var(--muted)] mt-3 max-w-2xl text-[14.5px] leading-relaxed">
            Local, zero-trust perception + tiered redaction for light-weight browser agents. On-device{" "}
            <span className="text-[var(--text)] font-semibold">DOM Extractor + PaddleOCR + Florence-2</span> → Tier0 regex/checksum → Tier1 Ettin-68M → Tier2 Qwen 2B → deterministic redaction → self-audit. Server: <span className="text-[var(--text)] font-semibold">required Qwen3 Reasoning Server</span> via vLLM/Ollama.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Link href="/docs" className="px-5 py-2.5 rounded-full bg-[#2563eb] dark:bg-white text-white dark:text-black text-sm font-semibold hover:bg-[#1d4ed8] dark:hover:bg-zinc-200 transition shadow-sm">
              Browse Docs
            </Link>
            <Link href="/changelog" className="px-5 py-2.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-sm hover:bg-[var(--card-soft)] transition">
              View Changelog
            </Link>
            <Link href="/docs/kickoff" className="px-5 py-2.5 rounded-full bg-[#0f172a] dark:bg-[#7c5cff] text-white text-sm font-semibold hover:bg-black dark:hover:bg-[#6b4de6] transition shadow-sm">
              Kickoff →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 text-[11px] text-[var(--faint)]">
            <span className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg)]">7 tools · keepalive</span>
            <span className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg)]">Fail-closed</span>
            <span className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg)] hidden sm:inline">Chrome 116+ · White-blue + Dark</span>
          </div>
        </div>
      </div>

      {/* Pinned — Urgent / Must-Do / Ongoing — white-blue light, dark gradient */}
      <div className="rounded-[16px] border border-[#fecaca] dark:border-[#ff4d4d]/20 bg-gradient-to-br from-[#fff7f7] to-[var(--card)] dark:from-[#1a1214] dark:to-[#14141c] overflow-hidden shadow-sm dark:shadow-none">
        <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[#fef2f2]/60 dark:bg-[#0f0f14]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-[#fef2f2] dark:bg-[#ff4d4d]/15 border border-[#fecaca] dark:border-[#ff4d4d]/30 grid place-items-center text-[14px]">📌</span>
            <div>
              <div className="font-bold text-sm flex items-center gap-2 text-[var(--text)]">Urgent — Must do · Ongoing <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" /></div>
              <div className="text-xs text-[var(--faint)]">Pinned from <code className="px-1 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-[11px]">docs/data/pinned.json</code> — edit, push, auto-redeploys.</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            <span className="px-2 py-1 rounded-full bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] dark:bg-[#ff4d4d]/15 dark:text-[#ff8a8a]">{urgent.length} urgent</span>
            <span className="px-2 py-1 rounded-full bg-[#eff6ff] border border-[#bfdbfe] text-[#1d4ed8] dark:bg-[#7c5cff]/15 dark:text-[#a48fff]">{mustDo.length} must-do</span>
            <span className="px-2 py-1 rounded-full bg-[#fefce8] border border-[#fde68a] text-[#a16207] dark:bg-[#eab308]/15 dark:text-[#facc15]">{ongoing.length} ongoing</span>
          </div>
        </div>

        <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3 bg-[var(--bg)]/50 dark:bg-transparent">
          {pinned.map((t) => {
            const s = statusStyle[t.status] ?? statusStyle.ongoing;
            return (
              <Link
                key={t.id}
                href={t.link ?? "/docs/kickoff"}
                className={`group rounded-xl border bg-[var(--card)] p-4 card-hover shine ${s.border} shadow-sm dark:shadow-none`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold ${s.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {t.status}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">{t.priority} · {t.area}</span>
                </div>
                <div className="font-semibold text-sm mt-3 leading-snug text-[var(--text)] group-hover:text-[var(--accent)] transition">{t.title}</div>
                <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2 leading-relaxed">{t.description}</div>
                <div className="flex items-center justify-between mt-3 text-[11px] text-[var(--faint)]">
                  <span className="font-medium">{t.owner}</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">due {t.due ?? "—"}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="px-4 py-3 bg-[var(--card-soft)]/60 dark:bg-[#0a0a0f]/50 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[var(--faint)]">To pin/unpin: edit <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/data/pinned.json</code> (push → live). Remove to unpin; <code>status:"done"</code> to archive.</span>
          <Link href="/docs/kickoff" className="px-3 py-1.5 rounded-full bg-[#2563eb] dark:bg-[#7c5cff] text-white font-medium hover:bg-[#1d4ed8] transition">Open Kickoff →</Link>
        </div>
      </div>

      {/* Cards — light cards white, dark #14141c */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group relative rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 overflow-hidden card-hover shine shadow-sm dark:shadow-none"
          >
            <div className={`absolute inset-0 opacity-[0.04] dark:opacity-[0.06] bg-gradient-to-br ${c.accent}`} />
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-[var(--card-soft)] border border-[var(--border)] grid place-items-center text-sm shadow-sm">{c.icon}</div>
              <div className="font-bold text-sm mt-3 text-[var(--text)]">{c.title}</div>
              <div className="text-[13px] text-[var(--muted)] mt-1 leading-snug">{c.desc}</div>
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563eb] dark:text-[#7c5cff] mt-3 group-hover:gap-2 transition-all">Open <span>→</span></div>
            </div>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm dark:shadow-none">
        <div className="font-bold text-sm flex items-center gap-2 text-[var(--text)]"><span className="w-6 h-6 rounded-lg bg-[#eff6ff] dark:bg-[#7c5cff]/15 border border-[#bfdbfe] dark:border-[#7c5cff]/30 grid place-items-center text-xs">✦</span> How to document while testing</div>
        <ol className="list-decimal pl-5 text-sm text-[var(--muted)] mt-3 space-y-1.5">
          <li>Edit any <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/*.md</code> or <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/tasks/*.md</code> — changes appear on next deploy (or <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">npm run dev</code>).</li>
          <li>Pin urgent work in <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/data/pinned.json</code> — appears in the pinned section above. Toggle ☀/☾ top-right to test light/dark.</li>
          <li>Log every reshape in <Link href="/changelog" className="underline decoration-[#2563eb]/40 dark:decoration-[#7c5cff]/50 text-[#2563eb] dark:text-[#a48fff]">Changelog</Link> via <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/CHANGELOG.md</code>.</li>
          <li>Push to <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">main</code> → Vercel auto-deploys <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/</code>. Share the Vercel URL with judges.</li>
        </ol>
      </div>
    </div>
  );
}
