# frontend — Vite + Svelte SPA

TypeScript single-page dashboard. Pure static build — no Node server, no Vercel.
Talks to the Hono backend over HTTP/SSE.

```bash
bun run dev          # vite  → http://localhost:5173 (proxies /api to :8787)
bun run build        # static output in dist/  (served by nginx in deploy/)
```

- `src/main.ts` — entrypoint: gates behind Clerk sign-in when
  `VITE_CLERK_PUBLISHABLE_KEY` is set (`@clerk/clerk-js`), else mounts open.
- `src/lib/auth.ts` — Clerk load + `getToken()` (graceful-optional).
- `src/App.svelte` — **working** chat surface: POSTs to `/api/chat` (with the
  Clerk token when auth is on) and renders the SSE token stream; shares
  `ChatRequest`/`ChatStreamEvent` with the backend via `@df-cerebe/shared`.
- `vite.config.ts` — dev proxy + Svelte plugin.

Verified against the pinned majors (Svelte 5.56, Vite 8, plugin-svelte 7,
clerk-js 6.16): `bun run build` and `svelte-check` both pass. Deps declared but
not installed in the template.
