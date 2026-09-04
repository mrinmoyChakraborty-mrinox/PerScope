import Link from "next/link";
import { DOC_ENTRIES } from "@/lib/docs";

export default function Tasks() {
  const tasks = DOC_ENTRIES.filter((d) => d.group === "Tasks");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black">Team Tasks — Person 1–6</h1>
      <p className="text-sm text-[#b8b8d0]">From <code>docs/tasks/*.md</code>. Owners: Lead / Perception (Jeet) / Privacy (Koyel) / Extension (Shritama) / Server-Bridge (Banashree) / QA-Pitch (Adreeja).</p>
      <div className="grid md:grid-cols-2 gap-4">
        {tasks.map((t) => (
          <Link key={t.slug} href={`/docs/${t.slug}`} className="rounded-xl border border-[#23233a] bg-[#14141c] p-5 hover:border-[#7c5cff]/50">
            <div className="font-semibold text-sm">{t.title}</div>
            <div className="text-xs text-[#8a8aa0] mt-1">{t.file} · Build Steps {t.slug.includes("01") ? "1" : t.slug.includes("02") ? "2–3" : t.slug.includes("03") ? "2,4–5" : t.slug.includes("04") ? "1,4,6,9" : t.slug.includes("05") ? "6–7" : "10"}</div>
          </Link>
        ))}
      </div>
      <div className="rounded-xl border border-[#23233a] bg-[#1a1a2a] p-4 text-sm">
        Build order is in <Link href="/docs/build-order" className="underline text-[#7c5cff]">Build Order (10 steps)</Link> — sorted by Build Step, not Task ID. MVP re-cut at bottom.
      </div>
    </div>
  );
}
