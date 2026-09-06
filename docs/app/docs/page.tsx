import Link from "next/link";
import { getAllDocsGrouped } from "@/lib/docs";

const groupMeta: Record<string, { icon: string; desc: string }> = {
  Meta: { icon: "📌", desc: "Start here + changelog" },
  Core: { icon: "◈", desc: "Architecture, schema, build, security" },
  Tasks: { icon: "▦", desc: "Person 1–6 — who builds what" },
};

export default function DocsIndex() {
  const groups = getAllDocsGrouped();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-[var(--text)]">Team Docs</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Every <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-xs">docs/*.md</code> and <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-xs">docs/tasks/*.md</code> rendered live. Vercel root: <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)] text-xs">docs</code>.</p>
      </div>

      {Object.entries(groups).map(([group, entries]) => (
        <div key={group}>
          <div className="flex items-center gap-2 mt-6 mb-3">
            <span className="w-7 h-7 rounded-lg bg-[var(--card-soft)] border border-[var(--border)] grid place-items-center text-xs">{groupMeta[group]?.icon ?? "•"}</span>
            <div>
              <div className="text-xs uppercase tracking-widest font-bold text-[var(--text)]">{group}</div>
              <div className="text-xs text-[var(--faint)]">{groupMeta[group]?.desc}</div>
            </div>
            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-[var(--card-soft)] border border-[var(--border)] text-[var(--faint)]">{entries.length}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {entries.map((e) => (
              <Link
                key={e.slug}
                href={`/docs/${e.slug}`}
                className="group relative rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 overflow-hidden card-hover shine shadow-sm dark:shadow-none"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] bg-gradient-to-br from-[#2563eb] dark:from-[#7c5cff] to-transparent transition" />
                <div className="relative">
                  <div className="font-semibold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition">{e.title}</div>
                  <div className="text-xs text-[var(--faint)] mt-1 font-mono">{e.file}</div>
                  <div className="text-xs text-[#2563eb] dark:text-[#7c5cff] mt-2 font-medium group-hover:gap-1 flex items-center gap-1">Open <span className="transition group-hover:translate-x-0.5">→</span></div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <div className="font-bold text-sm flex items-center gap-2 text-[var(--text)]"><span className="w-6 h-6 rounded-lg bg-[#eff6ff] dark:bg-[#00e5a0]/15 border border-[#bfdbfe] dark:border-[#00e5a0]/20 grid place-items-center text-xs">＋</span> How to add a new doc</div>
        <div className="text-sm text-[var(--muted)] mt-2">1. Create <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/my-new-doc.md</code>. 2. Add to <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">lib/docs.ts:DOC_ENTRIES</code> with <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">{"{ slug: \"my-new-doc\" }"}</code>. 3. Push — appears at <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">/docs/my-new-doc</code>.</div>
      </div>
    </div>
  );
}
