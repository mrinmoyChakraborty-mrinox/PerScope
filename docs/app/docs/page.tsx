import Link from "next/link";
import { getAllDocsGrouped } from "@/lib/docs";

export default function DocsIndex() {
  const groups = getAllDocsGrouped();
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-black">Team Docs</h1>
      <p className="text-sm text-[#b8b8d0]">All markdown in <code>docs/*.md</code> and <code>docs/tasks/*.md</code> — edit them and redeploy. Vercel root: <code>docs</code>.</p>
      {Object.entries(groups).map(([group, entries]) => (
        <div key={group}>
          <div className="text-xs uppercase tracking-widest text-[#8a8aa0] mt-6 mb-3">{group}</div>
          <div className="grid md:grid-cols-2 gap-3">
            {entries.map((e) => (
              <Link key={e.slug} href={`/docs/${e.slug}`} className="rounded-xl border border-[#23233a] bg-[#14141c] p-4 hover:border-[#7c5cff]/50">
                <div className="font-semibold text-sm">{e.title}</div>
                <div className="text-xs text-[#8a8aa0] mt-1">{e.file}</div>
              </Link>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-[#23233a] bg-[#1a1a2a] p-4 text-sm">
        <div className="font-semibold">How to add a new doc</div>
        <div className="text-[#b8b8d0] mt-1">1. Create <code>docs/my-new-doc.md</code>. 2. Add an entry to <code>lib/docs.ts:DOC_ENTRIES</code> with <code>slug:"my-new-doc"</code>. 3. Push — appears at <code>/docs/my-new-doc</code>.</div>
      </div>
    </div>
  );
}
