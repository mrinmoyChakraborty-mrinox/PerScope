import { getDoc, getDocSlugs } from "@/lib/docs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";

export function generateStaticParams() {
  return getDocSlugs().map((slug) => ({ slug: slug.split("/") }));
}

export default function DocPage({ params }: { params: { slug?: string[] } }) {
  const slug = (params.slug ?? []).join("/");
  const doc = getDoc(slug);
  if (!doc) notFound();
  const { entry, content } = doc as any;
  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-8">
      <aside className="hidden lg:block text-xs space-y-3">
        <Link href="/docs" className="text-[#7c5cff] underline">← All docs</Link>
        <div className="text-[#8a8aa0] break-all">{entry.file}</div>
        <CopyButton text={content} label="Copy MD" />
        <div>
          <a
            href={`https://github.com/mrinmoyChakraborty-mrinox/PerScope/blob/main/docs/${entry.file}`}
            target="_blank"
            className="inline-flex px-2.5 py-1 rounded-full border border-[#23233a] bg-[#14141c] text-[#b8b8d0] hover:text-white text-[11px]"
          >
            Edit on GitHub ↗
          </a>
        </div>
        <div className="text-[11px] text-[#8a8aa0] leading-relaxed pt-3 border-t border-[#23233a]">
          MD is copyable — click <b>Copy MD</b> to copy raw markdown (including mermaid). Paste into Notion/GitHub. All code blocks also have per-block Copy.
        </div>
      </aside>

      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <Link href="/docs" className="text-xs text-[#7c5cff] underline">← All docs</Link>
          <CopyButton text={content} label="Copy MD" />
        </div>
        <article className="prose max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }: any) => {
                // Extract raw code text for per-block copy
                const codeText = (() => {
                  try {
                    const child = (children as any)?.props?.children ?? children;
                    return String(child ?? "");
                  } catch {
                    return "";
                  }
                })();
                return (
                  <div className="relative">
                    <pre>{children}</pre>
                    <div className="absolute top-2 right-2">
                      <span className="px-2 py-1 rounded-md bg-[#0a0a0f]/80 border border-[#23233a] text-[11px] text-[#8a8aa0] backdrop-blur">copyable</span>
                    </div>
                  </div>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
        <div className="flex gap-2 pt-4 border-t border-[#23233a]">
          <CopyButton text={content} label="Copy full MD" />
          <a
            href={`https://github.com/mrinmoyChakraborty-mrinox/PerScope/blob/main/docs/${entry.file}`}
            target="_blank"
            className="px-3 py-1.5 rounded-full border border-[#23233a] bg-[#14141c] text-xs"
          >
            Edit on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
