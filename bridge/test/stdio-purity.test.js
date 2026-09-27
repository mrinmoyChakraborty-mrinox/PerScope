import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startTestDaemon } from "./helpers.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");

/**
 * Regression test for the classic failure mode: a stray console.log in the
 * `mcp` subprocess corrupts the stdio transport and silently breaks every
 * connected agent. Every stdout line must be a valid JSON-RPC frame.
 */
test("mcp subcommand writes only JSON-RPC frames to stdout", async () => {
  const { dir, daemon } = await startTestDaemon();
  const child = spawn(process.execPath, [CLI, "mcp"], {
    env: { ...process.env, PERSCOPE_BRIDGE_DIR: dir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  // Drain stderr so a chatty daemon can never backpressure the test.
  child.stderr.on("data", () => {});

  const frame = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  // Give the proxy a moment to attach to the already-running daemon.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "purity", version: "0" } } });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  frame({ jsonrpc: "2.0", method: "notifications/initialized" });
  frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  child.kill();
  await new Promise((resolve) => child.on("close", resolve));
  await daemon.close();

  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.length > 0, "expected at least one stdout frame");
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      assert.fail(`non-JSON stdout line: ${line.slice(0, 200)}`);
    }
    assert.equal(parsed.jsonrpc, "2.0", `non-JSON-RPC stdout line: ${line.slice(0, 200)}`);
    assert.ok(
      "id" in parsed || "result" in parsed || "error" in parsed || "method" in parsed,
      `unrecognized frame: ${line.slice(0, 200)}`,
    );
  }
  const listed = lines.map((l) => JSON.parse(l)).find((m) => m.id === 2);
  assert.ok(listed && !listed.error, "tools/list should succeed over the proxy");
  const names = listed.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "capture_tab",
    "click",
    "list_interactive_elements",
    "list_tabs",
    "read_page",
    "scroll",
    "select_option",
    "submit",
    "type",
  ]);
});
