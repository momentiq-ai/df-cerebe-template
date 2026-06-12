import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Vite + Svelte SPA. `bun run dev` launches this (Vite still drives bundling/HMR
// for Svelte; Bun is the installer + script runner). Output is static files —
// deployable to any static host or the nginx image in deploy/docker.
export default defineConfig({
  plugins: [svelte()],
  envDir: "..",
  server: {
    port: 5173,
    // Proxy /api to the Hono backend in dev so the browser sees one origin and
    // SSE streaming works without CORS friction. VITE_API_BASE_URL stays the
    // source of truth for prod. NOTE(verify): confirm SSE passes through the
    // proxy cleanly on the Vite version you install.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
