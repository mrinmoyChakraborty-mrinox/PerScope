#!/usr/bin/env node
/* Serve benchmark fixtures on 127.0.0.1 (keep running in its own terminal).
   Usage: node benchmarks/serve-fixtures.mjs [--port=7341] */
import { startFixtureServer } from "./lib/serve.mjs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let port = 7341;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--port=")) port = parseInt(a.split("=")[1], 10) || 7341;
  else if (a === "--port") port = parseInt(args[++i], 10) || 7341;
}
const root = fileURLToPath(new URL("./fixtures/", import.meta.url));

const server = await startFixtureServer(root, port);
console.log(`benchmark fixtures at http://127.0.0.1:${server.address()?.port || port}/ (root: ${root})`);
await new Promise(() => {});
