"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "./Mermaid";
import { CopyCodeButton } from "./CopyButton";

function extractText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) return extractText(node.props?.children);
  return "";
}

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: ({ className, children, ...props }: any) => {
          const lang = /language-(\w+)/.exec(className || "")?.[1] ?? "";
          const text = extractText(children).replace(/\n$/, "");
          if (lang === "mermaid") {
            return <Mermaid chart={text} />;
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }: any) => {
          // If this pre wraps a mermaid code block, render diagram without the <pre> frame
          try {
            const child: any = Array.isArray(children) ? children[0] : children;
            const cls: string = child?.props?.className ?? "";
            if (/language-mermaid/.test(cls)) {
              const text = extractText(child?.props?.children).replace(/\n$/, "");
              return <Mermaid chart={text} />;
            }
          } catch {
            /* fall through to normal pre */
          }
          const codeText = extractText(children).replace(/\n$/, "");
          return (
            <div className="relative group">
              <pre>{children}</pre>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                <CopyCodeButton code={codeText} />
              </div>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
