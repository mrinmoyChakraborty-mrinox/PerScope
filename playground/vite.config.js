import { defineConfig } from "vite";

// Playground dev server: app served at `/` (SPA entry), no directory
// listing, no `.html` paths. Entry is the root index.html; UI modules
// stay under ui/, shared code under js/ — all inside root, so relative
// imports resolve without fs escapes.
export default defineConfig({
  root: ".",
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  appType: "spa",
});
