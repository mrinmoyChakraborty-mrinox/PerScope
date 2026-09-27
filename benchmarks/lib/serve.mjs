/* PerScope benchmark harness — fixture static server (Node builtins only).
   Serves benchmarks/fixtures/ on 127.0.0.1. No directory listing, no
   escapes: only allowlisted extensions under the root resolve. */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

export async function startFixtureServer(rootDir, port) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
      const rel = path.normalize(urlPath).replace(/^[/\\]+/, "");
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      if (!TYPES[ext] || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[ext], "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `fixture port ${port} is already in use — pass --port <free-port> (checked: ` +
              `7331/7332/7333/7339/3000/1234/11434 are the project's own; pick anything else free).`,
          ),
        );
      } else reject(err);
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
