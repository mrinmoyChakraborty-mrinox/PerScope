#!/usr/bin/env node
import { runDaemon } from "../src/daemon.js";
import { runProxy } from "../src/mcp-stdio-proxy.js";
import { connectDaemon, stopDaemon } from "../src/daemon-control.js";

const [, , subcommand] = process.argv;

function usage() {
  console.error("Usage: perscope-bridge <connect|disconnect|terminate|daemon|mcp>");
  console.error("");
  console.error("  connect     Make sure the bridge daemon is running (starts it");
  console.error("              if needed) and show how to reach it + pairing code.");
  console.error("  disconnect  Stop the bridge daemon gracefully.");
  console.error("  terminate   Stop the bridge daemon immediately (force).");
  console.error("  daemon      Start the long-running bridge (WS + MCP + dashboard).");
  console.error("  mcp         Stdio proxy for MCP clients: ensures the singleton");
  console.error("              daemon is running, then pipes stdin/stdout to it.");
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
} else if (subcommand === "connect") {
  connectDaemon()
    .then((info) => {
      console.log(`[perscope] bridge ${info.started ? "started" : "already running"} (pid ${info.pid})`);
      console.log(`[perscope] MCP HTTP : ${info.mcpUrl}`);
      console.log(`[perscope] dashboard: ${info.dashboardUrl}`);
      if (info.pairingCode) {
        console.log(`[perscope] pairing code: ${info.pairingCode} (enter once in the extension)`);
      } else if (typeof info.pairedClients === "number") {
        console.log(
          `[perscope] paired clients: ${info.pairedClients}` +
            (info.extensionConnected ? " (extension connected)" : " (extension not connected)")
        );
      }
    })
    .catch((err) => {
      console.error(`[perscope] connect failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
} else if (subcommand === "disconnect" || subcommand === "terminate") {
  const force = subcommand === "terminate";
  stopDaemon({ force })
    .then((res) => {
      if (res.stopped) {
        console.log(`[perscope] bridge stopped (was pid ${res.pid})`);
      } else {
        console.log(`[perscope] nothing to stop (${res.reason})`);
      }
    })
    .catch((err) => {
      console.error(`[perscope] stop failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
} else {
  usage();
  process.exit(2);
}
