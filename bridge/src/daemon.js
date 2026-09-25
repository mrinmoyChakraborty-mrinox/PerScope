import { acquireLock, releaseLock } from "./lockfile.js";
import { startHttpServer, startRelayServer } from "./mcp-server.js";
import { ExtensionBridge } from "./ws-server.js";
import { loadConfig } from "./config.js";

/**
 * Long-running daemon: paired WS server (extension-facing) + MCP server
 * (internal stdio relay + streamable HTTP, agent-facing) + pairing
 * dashboard + singleton lockfile. Stays alive until killed.
 */
export async function runDaemon(config = loadConfig()) {
  const bridge = new ExtensionBridge({
    port: config.wsPort,
    dir: config.dir,
    toolTimeoutMs: config.toolTimeoutMs,
  });
  bridge.on("pairing-rotated", (pairing) => {
    if (pairing.code) {
      console.log(`[perscope-bridge] pairing code rotated (lockout/expiry): ${pairing.code}`);
    }
  });

  const { wsPort } = await bridge.start();
  const { httpServer, httpPort } = await startHttpServer(bridge, {
    port: config.httpPort,
    toolTimeoutMs: config.toolTimeoutMs,
    getPairing: () => bridge.getPairingCode(),
    getStatus: () => bridge.getStatus(),
  });
  const { tcp, relayPort } = await startRelayServer(bridge, {
    port: config.relayPort,
    toolTimeoutMs: config.toolTimeoutMs,
  });

  let lock;
  try {
    lock = await acquireLock(config.dir, { wsPort, httpPort, relayPort });
  } catch (err) {
    await new Promise((resolve) => httpServer.close(resolve));
    await new Promise((resolve) => tcp.close(resolve));
    await bridge.close();
    throw err;
  }

  const pairing = bridge.getPairingCode();
  console.log(`[perscope-bridge] daemon running (pid ${process.pid})`);
  console.log(`[perscope-bridge] extension WS : ws://127.0.0.1:${wsPort}`);
  console.log(`[perscope-bridge] MCP HTTP     : http://127.0.0.1:${httpPort}/mcp`);
  console.log(`[perscope-bridge] dashboard    : http://127.0.0.1:${httpPort}/`);
  if (pairing.code) {
    console.log(`[perscope-bridge] pairing code : ${pairing.code} (expires in 10 min, single-use)`);
  } else {
    console.log(`[perscope-bridge] known paired clients: ${bridge.getStatus().pairedClients}`);
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => tcp.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    await bridge.close();
    releaseLock(config.dir);
  };
  process.on("SIGINT", () => close().then(() => process.exit(0)));
  process.on("SIGTERM", () => close().then(() => process.exit(0)));

  return {
    bridge,
    ports: { wsPort, httpPort, relayPort },
    getPairingCode: () => bridge.getPairingCode(),
    getStatus: () => bridge.getStatus(),
    close,
  };
}
