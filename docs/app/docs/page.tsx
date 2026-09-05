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
        <h1 className="text-2xl font-black tracking-tight">Team Docs</h1>
        <p className="text-sm text-[#b8b8d0] mt-1">Every <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a] text-xs">docs/*.md</code> and <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a] text-xs">docs/tasks/*.md</code> rendered live. Vercel root: <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a] text-xs">docs</code>.</p>
      </div>

      {Object.entries(groups).map(([group, entries]) => (
        <div key={group}>
          <div className="flex items-center gap-2 mt-6 mb-3">
            <span className="w-7 h-7 rounded-lg bg-[#1a1a2a] border border-[#23233a] grid place-items-center text-xs">{groupMeta[group]?.icon ?? "•"}</span>
            <div>
              <div className="text-xs uppercase tracking-widest font-bold text-[#e6e6f0]">{group}</div>
              <div className="text-xs text-[#8a8aa0]">{groupMeta[group]?.desc}</div>
            </div>
            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-[#1a1a2a] border border-[#23233a] text-[#8a8aa0]">{entries.length}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {entries.map((e) => (
              <Link
                key={e.slug}
                href={`/docs/${e.slug}`}
                className="group relative rounded-xl border border-[#23233a] bg-[#14141c] p-4 overflow-hidden card-hover shine"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] bg-gradient-to-br from-[#7c5cff] to-transparent transition" />
                <div className="relative">
                  <div className="font-semibold text-sm group-hover:text-white transition">{e.title}</div>
                  <div className="text-xs text-[#8a8aa0] mt-1 font-mono">{e.file}</div>
                  <div className="text-xs text-[#7c5cff] mt-2 font-medium group-hover:gap-1 flex items-center gap-1">Open <span className="transition group-hover:translate-x-0.5">→</span></div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-[#23233a] bg-[#14141c] p-5">
        <div className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-[#00e5a0]/15 border border-[#00e5a0]/20 grid place-items-center text-xs">＋</span> How to add a new doc</div>
        <div className="text-sm text-[#b8b8d0] mt-2">1. Create <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/my-new-doc.md</code>. 2. Add to <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">lib/docs.ts:DOC_ENTRIES</code> with <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">{"{ slug: \"my-new-doc\" }"}</code>. 3. Push — appears at <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">/docs/my-new-doc</code>.</div>
      </div>
    </div>
  );
}
