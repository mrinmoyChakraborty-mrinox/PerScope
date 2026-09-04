import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "PerScope — Team Docs | SIH26171 Cosmic Crux",
  description: "PerScope team documentation — architecture, build order, tasks, security, changelog. SIH26171 ISRO.",
};

const nav = [
  { href: "/", label: "Overview" },
  { href: "/docs", label: "Docs" },
  { href: "/changelog", label: "Changelog" },
  { href: "/tasks", label: "Tasks" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 backdrop-blur bg-[#0a0a0f]/80 border-b border-[#23233a]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7c5cff] to-[#00e5a0] grid place-items-center font-black text-white text-sm">P</span>
              <span className="font-bold tracking-tight">PerScope</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-[#23233a] text-[#b8b8d0] hidden sm:inline">SIH26171 · Cosmic Crux</span>
            </Link>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="px-3 py-1.5 rounded-lg hover:bg-[#1a1a2a] text-sm">
                  {n.label}
                </Link>
              ))}
              <a href="https://github.com/mrinmoyChakraborty-mrinox/PerScope" target="_blank" className="px-3 py-1.5 rounded-lg bg-[#7c5cff] text-white text-sm ml-2">GitHub</a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
        <footer className="max-w-6xl mx-auto px-4 py-8 text-xs text-[#8a8aa0] border-t border-[#23233a] mt-12">
          PerScope — See everything. Leak nothing. · Team Cosmic Crux · Docs auto-deploy from <code>docs/</code> on Vercel · Edit <code>docs/CHANGELOG.md</code> to log changes.
        </footer>
      </body>
    </html>
  );
}
