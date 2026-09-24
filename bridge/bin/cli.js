#!/usr/bin/env node
import { runDaemon } from "../src/daemon.js";
import { runProxy } from "../src/mcp-stdio-proxy.js";

const [, , subcommand] = process.argv;

function usage() {
  console.error("Usage: perscope-bridge <daemon|mcp>");
  console.error("");
  console.error("  daemon   Start the long-running bridge (WS + MCP + dashboard).");
  console.error("  mcp      Stdio proxy for MCP clients: ensures the singleton");
  console.error("           daemon is running, then pipes stdin/stdout to it.");
}

if (subcommand === "daemon") {
  runDaemon().catch((err) => {
    console.error(`[perscope-bridge] daemon failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
} else if (subcommand === "mcp") {
  // NOTE: stdout is reserved for MCP frames. Usage errors go to stderr.
  runProxy().catch((err) => {
    console.error(`[perscope-bridge] proxy failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
} else {
  usage();
  process.exit(2);
}
