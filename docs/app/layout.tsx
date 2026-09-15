import "./globals.css";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('perscope-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s||(d?'dark':'light');document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.classList.toggle('light',t==='light')}catch(e){}})()`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body className="min-h-screen selection:bg-[var(--selection)]">
        {/* Background glows — adapt to theme */}
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[var(--bg)]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-[var(--accent)] opacity-[0.06] blur-[90px] rounded-full dark:opacity-[0.07]" />
          <div className="absolute top-24 right-[10%] w-[520px] h-[320px] bg-[var(--accent-2)] opacity-[0.05] blur-[80px] rounded-full dark:opacity-[0.04]" />
          <div className="absolute bottom-0 left-[5%] w-[600px] h-[300px] bg-[#7c5cff] opacity-[0.03] blur-[80px] rounded-full dark:opacity-[0.03]" />
        </div>

        <header className="sticky top-0 z-20 glass bg-[var(--bg)]/80 border-b border-[var(--border)]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2563eb] to-[#06b6d4] dark:from-[#7c5cff] dark:to-[#00e5a0] grid place-items-center font-black text-white text-[13px] shadow-lg shadow-[#2563eb]/20 dark:shadow-[#7c5cff]/20 shrink-0">
                P
              </span>
              <span className="font-black tracking-tight text-[15px] hidden sm:inline">PerScope</span>
              <span className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--card-soft)] text-[var(--faint)] hidden lg:inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00b894] dark:bg-[#00e5a0] animate-pulse" /> SIH26171 · Cosmic Crux · v4 tested
              </span>
            </Link>

            <div className="flex items-center gap-1">
              <nav className="hidden sm:flex items-center gap-1">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="px-3.5 py-1.5 rounded-full text-[13px] font-medium text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--card-soft)] transition whitespace-nowrap"
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
              {/* Mobile nav */}
              <nav className="flex sm:hidden gap-1">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="px-2.5 py-1.5 rounded-full text-xs bg-[var(--card-soft)] border border-[var(--border)]">
                    {n.label[0]}
                  </Link>
                ))}
              </nav>

              <span className="w-px h-6 bg-[var(--border)] mx-1 hidden sm:block" />
              <ThemeToggle />
              <a
                href="https://github.com/mrinmoyChakraborty-mrinox/PerScope"
                target="_blank"
                className="ml-1 px-3.5 py-1.5 rounded-full bg-[var(--text)] text-[var(--bg)] dark:bg-white dark:text-black text-[13px] font-semibold hover:opacity-90 transition whitespace-nowrap"
              >
                GitHub ↗
              </a>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8 md:py-10">{children}</main>

        <footer className="max-w-6xl mx-auto px-4 py-8 mt-8">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/70 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[var(--faint)]">
            <span>
              <span className="font-semibold text-[var(--text)]">PerScope</span> — See everything. Leak nothing. · Team Cosmic Crux
            </span>
            <span className="flex items-center gap-2">
              Docs auto-deploy from <code className="px-1.5 py-0.5 rounded bg-[var(--code-bg)] border border-[var(--code-border)]">docs/</code> on Vercel
              <span className="hidden sm:inline">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#2563eb] dark:bg-[#7c5cff]" /> light
                <span className="opacity-40">/</span> dark
              </span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
