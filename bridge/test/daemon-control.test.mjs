import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { connectDaemon, stopDaemon } from "../src/daemon-control.js";
import { lockPath } from "../src/lockfile.js";

const CLI = path.join(import.meta.dirname, "..", "bin", "cli.js");
void CLI;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("stop with no lock reports not-running", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "perscope-ctl-"));
  const config = { ...loadConfig({}), dir };
  assert.deepEqual(await stopDaemon({ config }), { stopped: false, reason: "not-running" });
});

test("stop refuses our own pid", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "perscope-ctl-"));
  fs.writeFileSync(
    lockPath(dir),
    JSON.stringify({ pid: process.pid, wsPort: 1, httpPort: 2, relayPort: 3 }),
  );
  const config = { ...loadConfig({}), dir };
  const res = await stopDaemon({ config });
  assert.equal(res.stopped, false);
  assert.match(res.reason, /own process/);
  fs.unlinkSync(lockPath(dir));
});

test("connect spawns, reports, and stop/connect cycle works end to end", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "perscope-ctl-"));
  const config = { ...loadConfig({}), dir };
  // The spawned daemon inherits process env, so point it at the temp dir
  // (ephemeral ports) for the duration of this test.
  const savedEnv = { ...process.env };
  process.env.PERSCOPE_BRIDGE_DIR = dir;
  process.env.PERSCOPE_BRIDGE_PORT = "0";
  process.env.PERSCOPE_BRIDGE_HTTP_PORT = "0";
  process.env.PERSCOPE_BRIDGE_RELAY_PORT = "0";
  let child = null;
  try {
    // No daemon: connectDaemon must spawn one itself.
    const first = await connectDaemon(config);
    assert.equal(first.started, true);
    assert.ok(typeof first.pid === "number" && first.pid !== process.pid);
    assert.match(first.mcpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.match(first.dashboardUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.match(first.pairingCode ?? "", /^\d{6}$/);
    assert.ok(pidAlive(first.pid));
    child = first.pid;

    // Already running: reports without spawning.
    const second = await connectDaemon(config);
    assert.equal(second.started, false);
    assert.equal(second.pid, first.pid);

    // Graceful stop kills the daemon and clears the lock.
    const stopped = await stopDaemon({ config });
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.pid, first.pid);
    assert.equal(pidAlive(first.pid), false);
    assert.equal(fs.existsSync(lockPath(dir)), false);
    child = null;

    // Stopping again is a clean no-op.
    assert.deepEqual(await stopDaemon({ config }), { stopped: false, reason: "not-running" });
  } finally {
    if (child !== null && pidAlive(child)) {
      try {
        process.kill(child, "SIGKILL");
      } catch {
        // Best effort.
      }
    }
    process.env = savedEnv;
  }
});
