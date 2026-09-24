import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { acquireLock, isDaemonRunning, lockPath, readLock, releaseLock } from "../src/lockfile.js";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "perscope-lock-test-"));
}

async function listenEphemeral() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("acquire → running → release → not running", async () => {
  const dir = await tempDir();
  const probe = await listenEphemeral();
  const port = probe.address().port;
  await acquireLock(dir, { wsPort: port, httpPort: 1, relayPort: 2 });
  assert.ok(fs.existsSync(lockPath(dir)));
  const up = await isDaemonRunning(dir);
  assert.equal(up.running, true);
  assert.equal(up.starting, false);
  assert.equal(up.info.wsPort, port);
  releaseLock(dir);
  assert.equal(fs.existsSync(lockPath(dir)), false);
  const down = await isDaemonRunning(dir);
  assert.equal(down.running, false);
  await new Promise((resolve) => probe.close(resolve));
});

test("second live holder in another process throws (singleton)", async () => {
  const dir = await tempDir();
  const probe = await listenEphemeral();
  const port = probe.address().port;
  // A child process claims the lock and stays alive holding it.
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    `import { acquireLock } from ${JSON.stringify(new URL("../src/lockfile.js", import.meta.url).href)};` +
      `await acquireLock(${JSON.stringify(dir)}, { wsPort: ${port} });` +
      `setInterval(() => {}, 1000);`,
  ], { stdio: "ignore" });
  try {
    // Wait until the child has written the lock.
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(lockPath(dir)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await assert.rejects(() => acquireLock(dir, { wsPort: 9999 }), /already running/);
    const status = await isDaemonRunning(dir);
    assert.equal(status.running, true);
  } finally {
    child.kill();
    await new Promise((resolve) => child.on("exit", resolve));
  }
  // Dead holder → stale lock cleared, claimable again.
  const after = await isDaemonRunning(dir);
  assert.equal(after.running, false);
  await acquireLock(dir, { wsPort: port });
  releaseLock(dir);
  await new Promise((resolve) => probe.close(resolve));
});

test("stale lock (dead pid) is cleared and reported not-running", async () => {
  const dir = await tempDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 2147483647, wsPort: 1 }));
  const status = await isDaemonRunning(dir);
  assert.equal(status.running, false);
  assert.equal(fs.existsSync(lockPath(dir)), false);
  // And a fresh daemon can claim it.
  const probe = await listenEphemeral();
  await acquireLock(dir, { wsPort: probe.address().port });
  assert.equal(readLock(dir).pid, process.pid);
  releaseLock(dir);
  await new Promise((resolve) => probe.close(resolve));
});

test("release never deletes a lock owned by another pid", async () => {
  const dir = await tempDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 2147483647, wsPort: 1 }));
  releaseLock(dir); // must not throw…
  assert.equal(fs.existsSync(lockPath(dir)), true); // …and must not delete it
});
