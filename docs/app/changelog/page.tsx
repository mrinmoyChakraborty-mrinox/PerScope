import { getDoc } from "@/lib/docs";
import { Markdown } from "@/components/Markdown";

export default function Changelog() {
  const doc = getDoc("changelog") as any;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Changelog</h1>
        <a href="https://github.com/mrinmoyChakraborty-mrinox/PerScope/blob/main/docs/CHANGELOG.md" target="_blank" className="text-xs px-3 py-1.5 rounded-lg border border-[#23233a] hover:bg-[#1a1a2a]">Edit on GitHub</a>
      </div>
      <p className="text-sm text-[#b8b8d0]">Single running record — add entries at the top using the template in <code>docs/CHANGELOG.md</code>. Vercel redeploys on push to <code>main</code>. Share this URL with judges.</p>
      <div className="rounded-xl border border-[#23233a] bg-[#1a1a2a] p-3 text-xs text-[#b8b8d0]">
        <strong>Template:</strong> <code>## YYYY-MM-DD — Area — Author</code> → Change / Why / Impact / Follow-up. Keep newest first. Link to PR or commit if useful.
      </div>
      <article className="prose max-w-none">
        <Markdown content={doc.content} />
      </article>
    </div>
  );
}
