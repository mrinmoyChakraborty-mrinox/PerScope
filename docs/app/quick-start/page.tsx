import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
  title: "PerScope — Quick Start & Setup Guide | SIH26171",
  description:
    "Verified setup and installation commands for running the PerScope Chrome extension, bridge daemon, and test suites.",
};

export default function QuickStartPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          GETTING STARTED
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-[var(--text)] tracking-tight">
          Quick Start & Developer Setup
        </h1>
        <p className="text-base text-[var(--muted)] max-w-3xl leading-relaxed">
          Step-by-step instructions to load the PerScope Chrome extension, connect the bridge daemon to Claude Code / OpenCode, and run verified test suites.
        </p>
      </section>

      {/* Prerequisites */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <h2 className="text-xl font-bold text-[var(--text)]">Prerequisites</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-1.5">
            <span className="font-bold text-[var(--text)]">🌐 Chromium Browser</span>
            <p className="text-[var(--muted)]">Google Chrome 116+ or Microsoft Edge with WebGPU enabled (chrome://flags/#enable-unsafe-webgpu if needed).</p>
          </div>
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-1.5">
            <span className="font-bold text-[var(--text)]">📦 Node.js Environment</span>
            <p className="text-[var(--muted)]">Node.js v18.0.0 or higher with npm (tested on Node v20.20.2).</p>
          </div>
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card-soft)]/50 space-y-1.5">
            <span className="font-bold text-[var(--text)]">⚡ Hardware Recommendation</span>
            <p className="text-[var(--muted)]">Dedicated GPU (NVIDIA RTX / Apple Silicon) recommended for 200ms latency. CPU with WASM SIMD supported as fallback.</p>
          </div>
        </div>
      </section>

      {/* Step 1: Loading the Extension */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[var(--accent)] text-white grid place-items-center font-bold text-xs">
            1
          </span>
          <h2 className="text-xl font-bold text-[var(--text)]">
            Load the Chrome Extension
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          The production extension source lives in <code>extension/v7 beta/</code>. It contains its own esbuild bundler producing a packaged <code>dist/</code> folder.
        </p>

        <CodeBlock
          language="bash"
          title="Build extension bundles"
          code={`# Navigate to extension directory
cd "extension/v7 beta"

# Install extension bundling dependencies
npm install

# Bundle popup, service worker, offscreen, and content scripts
node build.mjs`}
        />

        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] space-y-2 text-xs">
          <div className="font-bold text-[var(--text)]">Load in Chrome:</div>
          <ol className="list-decimal pl-5 space-y-1 text-[var(--muted)]">
            <li>Open Google Chrome and navigate to <code className="font-mono text-[var(--prose-code)]">chrome://extensions</code></li>
            <li>Enable <strong>Developer mode</strong> in the top-right corner.</li>
            <li>Click <strong>Load unpacked</strong>.</li>
            <li>Select the folder: <code className="font-mono text-[var(--prose-code)]">extension/v7 beta/dist</code> (or <code className="font-mono text-[var(--prose-code)]">extension/v7 beta</code>).</li>
            <li>The PerScope icon will appear in your Chrome toolbar. Pin it for quick access.</li>
          </ol>
        </div>
      </section>

      {/* Step 2: Running the Bridge Daemon */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white grid place-items-center font-bold text-xs">
            2
          </span>
          <h2 className="text-xl font-bold text-[var(--text)]">
            Run the @perscope/bridge Daemon (For Agent / MCP Mode)
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          If you want autonomous agents (Claude Code, OpenCode, Cursor) to drive the browser, start the local bridge daemon.
        </p>

        <CodeBlock
          language="bash"
          title="Start local bridge daemon"
          code={`# Navigate to bridge directory
cd bridge

# Install dependencies
npm install

# Start the daemon
node bin/cli.js daemon

# Bridge dashboard starts at http://127.0.0.1:7332/
# WebSocket for extension listens on ws://127.0.0.1:7331`}
        />

        <div className="text-xs text-[var(--muted)] leading-relaxed">
          Open the dashboard at <a href="http://127.0.0.1:7332/" target="_blank" className="font-mono text-[var(--accent)] underline">http://127.0.0.1:7332/</a>, copy the 6-digit pairing code, and paste it into the PerScope extension popup or options page to complete the handshake.
        </div>
      </section>

      {/* Step 3: Connect AI Agents via MCP */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-purple-600 text-white grid place-items-center font-bold text-xs">
            3
          </span>
          <h2 className="text-xl font-bold text-[var(--text)]">
            Register PerScope with Your AI Agent
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          PerScope exposes an official MCP server with tools including <code>capture_tab</code>, <code>read_page</code>, and interactive actions.
        </p>

        <div className="space-y-3">
          <div className="text-xs font-bold text-[var(--text)]">For Claude Code:</div>
          <CodeBlock
            language="bash"
            title="Claude Code CLI registration"
            code={`claude mcp add perscope -- npx -y @perscope/bridge mcp`}
          />

          <div className="text-xs font-bold text-[var(--text)]">For OpenCode (opencode.json):</div>
          <CodeBlock
            language="json"
            title="opencode.json MCP configuration"
            code={`{
  "mcp": {
    "perscope": {
      "type": "local",
      "command": ["npx", "-y", "@perscope/bridge", "mcp"]
    }
  }
}`}
          />
        </div>
      </section>

      {/* Step 4: Run Verified Test Suites */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white grid place-items-center font-bold text-xs">
            4
          </span>
          <h2 className="text-xl font-bold text-[var(--text)]">
            Run the Automated Test Suites
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Verify pipeline regression, DOM capture, and destructive action safety gates using the repository test runners:
        </p>

        <CodeBlock
          language="bash"
          title="Execute repository tests"
          code={`# Run DOM capture test suite (11 unit tests)
node "extension/v7 beta/tests/dom-capture.test.mjs"

# Run destructive action classifier test suite
node "extension/v7 beta/tests/is-destructive.test.mjs"

# Run root Qwen regression suite
npm test`}
        />
      </section>
    </div>
  );
}
