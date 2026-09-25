import os from "node:os";
import path from "node:path";

/**
 * Shared environment-based configuration for all bridge entrypoints.
 * Every value has a sane localhost-only default and can be overridden
 * via environment variables (which is also how tests point the package
 * at ephemeral ports and temp directories).
 */
export function loadConfig(env = process.env) {
  const num = (value, fallback) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const dir = env.PERSCOPE_BRIDGE_DIR || path.join(os.homedir(), ".perscope");
  return {
    dir,
    wsPort: num(env.PERSCOPE_BRIDGE_PORT, 7331),
    httpPort: num(env.PERSCOPE_BRIDGE_HTTP_PORT, 7332),
    relayPort: num(env.PERSCOPE_BRIDGE_RELAY_PORT, 7333),
    toolTimeoutMs: num(env.PERSCOPE_TOOL_TIMEOUT_MS, 60_000),
  };
}

export const TOOL_TIMEOUT_DEFAULT_MS = 60_000;
