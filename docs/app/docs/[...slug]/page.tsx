import { getDoc, getDocSlugs } from "@/lib/docs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { notFound } from "next/navigation";

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
      <aside className="hidden lg:block text-xs">
        <Link href="/docs" className="text-[#7c5cff] underline">← All docs</Link>
        <div className="mt-4 text-[#8a8aa0]">{entry.file}</div>
        <div className="mt-2"><a href={`https://github.com/mrinmoyChakraborty-mrinox/PerScope/blob/main/docs/${entry.file}`} target="_blank" className="underline text-[#b8b8d0]">Edit on GitHub</a></div>
      </aside>
      <article className="prose max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
