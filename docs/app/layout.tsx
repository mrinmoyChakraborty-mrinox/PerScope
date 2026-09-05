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
      <body className="min-h-screen selection:bg-[#7c5cff]/30">
        {/* Top glow */}
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[#0a0a0f]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-[#7c5cff] opacity-[0.07] blur-[90px] rounded-full" />
          <div className="absolute top-24 right-[10%] w-[500px] h-[300px] bg-[#00e5a0] opacity-[0.04] blur-[80px] rounded-full" />
        </div>

        <header className="sticky top-0 z-20 glass bg-[#0a0a0f]/70 border-b border-[#23233a]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#00e5a0] grid place-items-center font-black text-white text-[13px] shadow-lg shadow-[#7c5cff]/20 shrink-0">P</span>
              <span className="font-black tracking-tight text-[15px] hidden sm:inline">PerScope</span>
              <span className="text-[11px] px-2.5 py-1 rounded-full border border-[#23233a] bg-[#14141c] text-[#b8b8d0] hidden lg:inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00e5a0] animate-pulse" /> SIH26171 · Cosmic Crux · v3
              </span>
            </Link>
            <nav className="flex items-center gap-1 overflow-x-auto">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3.5 py-1.5 rounded-full text-[13px] font-medium hover:bg-[#1a1a2a] text-[#b8b8d0] hover:text-white transition whitespace-nowrap"
                >
                  {n.label}
                </Link>
              ))}
              <a
                href="https://github.com/mrinmoyChakraborty-mrinox/PerScope"
                target="_blank"
                className="ml-2 px-3.5 py-1.5 rounded-full bg-white text-black text-[13px] font-semibold hover:bg-zinc-200 transition whitespace-nowrap"
              >
                GitHub ↗
              </a>
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8 md:py-10">{children}</main>

        <footer className="max-w-6xl mx-auto px-4 py-8 mt-8">
          <div className="rounded-2xl border border-[#23233a] bg-[#14141c]/60 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#8a8aa0]">
            <span>
              <span className="font-semibold text-[#e6e6f0]">PerScope</span> — See everything. Leak nothing. · Team Cosmic Crux
            </span>
            <span className="flex items-center gap-2">
              Docs auto-deploy from <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">docs/</code> on Vercel · Edit <code className="px-1.5 py-0.5 rounded bg-[#1c1c2a] border border-[#23233a]">CHANGELOG.md</code>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
