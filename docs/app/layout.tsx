import "./globals.css";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = {
  title: "PerScope — Privacy-Preserving Browser AI | SIH26171 Cosmic Crux",
  description:
    "PerScope official documentation — On-Device Visual Perception and Zero-Trust Redaction Layer for Lightweight Browser Agents. SIH26171 ISRO / Smart Automation.",
};

const navLinks = [
  { href: "/", label: "Overview" },
  { href: "/user-flows", label: "User Flows & Modes" },
  { href: "/architecture", label: "Architecture" },
  { href: "/quick-start", label: "Quick Start" },
  { href: "/tested-vs-planned", label: "Tested vs Planned" },
  { href: "/limitations", label: "Limitations" },
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
        {/* Ambient background glows */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[var(--bg)]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-[var(--accent)] opacity-[0.06] blur-[100px] rounded-full dark:opacity-[0.08]" />
          <div className="absolute top-32 right-[8%] w-[550px] h-[340px] bg-[var(--accent-2)] opacity-[0.05] blur-[90px] rounded-full dark:opacity-[0.05]" />
          <div className="absolute bottom-10 left-[5%] w-[650px] h-[350px] bg-[#7c5cff] opacity-[0.04] blur-[90px] rounded-full dark:opacity-[0.04]" />
        </div>

        {/* Global Navigation Header */}
        <header className="sticky top-0 z-30 glass bg-[var(--bg)]/85 border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 shrink-0">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2563eb] to-[#06b6d4] dark:from-[#7c5cff] dark:to-[#00e5a0] grid place-items-center font-black text-white text-[14px] shadow-lg shadow-[#2563eb]/20 dark:shadow-[#7c5cff]/20">
                P
              </span>
              <div className="flex flex-col">
                <span className="font-black tracking-tight text-[16px] leading-tight text-[var(--text)]">
                  PerScope
                </span>
                <span className="text-[10px] text-[var(--faint)] font-mono hidden sm:inline">
                  SIH26171 · Team Cosmic Crux
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center gap-1">
              {navLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-full text-[13px] font-medium text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--card-soft)] transition"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right Action Items */}
            <div className="flex items-center gap-2">
              {/* Highlighted Judge Mode Link (Direct SIH PPT & QR Target) */}
              <Link
                href="/judge"
                className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-95 shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5 animate-pulse"
              >
                <span>⚡</span> Judge Mode
              </Link>

              <span className="w-px h-6 bg-[var(--border)] mx-1 hidden sm:block" />

              <ThemeToggle />

              <a
                href="https://github.com/mrinmoyChakraborty-mrinox/PerScope"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--card-soft)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)] transition hidden sm:inline-flex items-center gap-1"
              >
                <span>GitHub</span> ↗
              </a>
            </div>
          </div>

          {/* Mobile Navigation Scrollbar */}
          <div className="lg:hidden border-t border-[var(--border)] px-4 py-2 flex items-center gap-1 overflow-x-auto bg-[var(--card-soft)]/50">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--card)]"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>

        {/* Page Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10">{children}</main>

        {/* Footer */}
        <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 mt-12 border-t border-[var(--border)]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[var(--muted)]">
            <div className="flex items-center gap-3">
              <span className="font-bold text-[var(--text)]">PerScope</span>
              <span>·</span>
              <span>SIH26171: On-Device Visual Perception for Lightweight Browser Agents</span>
              <span>·</span>
              <span className="font-semibold text-[var(--accent)]">Team Cosmic Crux</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-[var(--faint)]">
              <Link href="/judge" className="hover:text-[var(--text)] font-semibold text-emerald-600 dark:text-emerald-400">
                Judge Mode (60s)
              </Link>
              <Link href="/user-flows" className="hover:text-[var(--text)]">
                Human & Bridge Modes
              </Link>
              <Link href="/tested-vs-planned" className="hover:text-[var(--text)]">
                Capability Audit
              </Link>
              <Link href="/quick-start" className="hover:text-[var(--text)]">
                Quick Start
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
