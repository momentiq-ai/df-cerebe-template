# backend — Hono + LangGraph.js

TypeScript agent backend. Runs natively under Bun in dev (no Docker).

```bash
bun run dev          # bun --hot src/index.ts  → http://localhost:8787
curl :8787/health    # liveness
```

- `src/index.ts` — Hono app: CORS, `/health`, `requireAuth` (Clerk,
  graceful-optional via `@clerk/backend`), and `POST /api/chat` streaming agent
  responses over SSE.
- `src/agent/graph.ts` — the LangGraph.js runtime (**implemented**: a `StateGraph`
  calling `ChatOpenAI`, streamed token-by-token). `runAgentTurn()` is the
  single entrypoint the HTTP layer calls.

Verified against the pinned majors (LangGraph 1.4, OpenAI 1.4, Hono 4.12,
Clerk backend 3.6). Needs `CEREBE_API_KEY` to answer; set `CLERK_SECRET_KEY`
to enforce auth (else open mode). Deps are declared but not installed in the
template — your `bun install` brings them in.
