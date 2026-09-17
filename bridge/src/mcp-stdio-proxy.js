import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { isDaemonRunning } from "./lockfile.js";

// HARD RULE: this process must never write anything except valid MCP
// JSON-RPC frames to stdout. All diagnostics go to stderr.
const log = (...args) => console.error("[perscope-bridge]", ...args);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function cliPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
}

/**
 * `perscope-bridge mcp`: ensure the singleton daemon exists (spawning it
 * detached if needed), then byte-pipe stdin/stdout to the daemon's
 * internal MCP relay. Pure proxy — no MCP logic, no logging to stdout.
 */
export async function runProxy(config = loadConfig()) {
  let status = await isDaemonRunning(config.dir);
  if (!status.running) {
    log("no daemon running; spawning detached daemon…");
    const child = spawn(process.execPath, [cliPath(), "daemon"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
  }

  // Wait for the daemon's relay port to accept connections.
  const deadline = Date.now() + 20_000;
  let relayPort = status.info?.relayPort ?? config.relayPort;
  for (;;) {
    status = await isDaemonRunning(config.dir);
    if (status.running && !status.starting && status.info?.relayPort) {
      relayPort = status.info.relayPort;
    }
    if (status.running && (await canConnect(relayPort))) break;
    if (Date.now() > deadline) {
      log(`timed out waiting for daemon relay on 127.0.0.1:${relayPort}`);
      process.exitCode = 1;
      return;
    }
    await sleep(250);
  }

  const sock = net.connect({ port: relayPort, host: "127.0.0.1" });
  sock.setNoDelay(true);
  await new Promise((resolve, reject) => {
    sock.on("connect", resolve);
    sock.on("error", reject);
  });

  let stdinEnded = false;
  let exiting = false;
  const exit = (code) => {
    if (exiting) return;
    exiting = true;
    process.exit(code);
  };
  process.stdin.on("end", () => {
    stdinEnded = true;
    sock.end();
    // The client is gone; its pipes are the only thing keeping us alive.
    // Give in-flight bytes a brief grace period to flush, then exit even
    // if the daemon keeps its side of the relay open (it serves many
    // proxies and never hangs up on our account).
    setTimeout(() => exit(0), 2000);
  });
  process.stdin.on("error", (err) => log("stdin error:", err.message));
  sock.on("error", (err) => {
    log("relay error:", err.message);
    if (!stdinEnded) process.exitCode = 1;
  });
  sock.on("close", () => {
    // Daemon went away mid-session: exit non-zero so the MCP client
    // restarts us (which re-runs daemon detection). A clean stdin EOF
    // above is the only graceful path.
    if (!stdinEnded) {
      log("daemon relay closed; exiting");
      exit(1);
    } else {
      exit(0);
    }
  });

  process.stdin.pipe(sock);
  sock.pipe(process.stdout, { end: false });
  sock.on("end", () => {
    // Daemon half-closed: keep stdout open until stdin ends.
  });
}
