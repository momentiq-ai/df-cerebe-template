# AGENTS.md — context for AI agents working in this repo

This file orients any AI coding agent (Claude Code, Cursor, Codex, etc.) working
in this repo. Humans: see [`README.md`](README.md) and
[`docs/getting-started.md`](docs/getting-started.md).

## What this is

This is an **internal dashboard** template built as a deliberately lean scaffold:

- **Backend:** Bun + Hono + LangGraph.js (TypeScript agent runtime) — `backend/`
- **Frontend:** Vite + Svelte SPA (TypeScript) — `frontend/`
- **Shared types:** `shared/` — imported by both ends; the point of TS-on-both-sides
- **Gate:** Dark Factory local critic quorum — `.agent-review/` + `.husky/`
- **Deploy:** Docker + Kubernetes — `deploy/`, **opt-in, never used in dev**

## Non-negotiable principles

1. **Native dev must never require Docker or Kubernetes.** The dev loop is
   `bun install` → `bun run dev`. Anything container/k8s belongs in `deploy/` and
   must not leak into the dev path or root dev scripts. If a change would make
   `bun run dev` depend on Docker, it's wrong.
2. **One language, shared types.** Cross-cutting shapes (API requests, stream
   events) live in `shared/` and are imported by both `backend/` and `frontend/`.
   Don't duplicate a type across the two sides.
3. **The Dark Factory gate is load-bearing.** Don't disable, bypass, or weaken
   `.husky/post-commit` / `.husky/pre-push` or `.agent-review/config.json` to get
   a commit through. Address findings in a **new commit** (never amend — artifacts
   are bound to the original SHA). Bypass only with `AGENT_REVIEW_BYPASS="reason"`
   for genuine emergencies, which is audited.

## Current status: WORKING TEMPLATE

- The backend agent (`backend/src/agent/graph.ts`, `index.ts`) and the streaming
  chat frontend (`frontend/src/App.svelte`) are **implemented and verified** —
  `bun install`, dev loop, type-checks, frontend build, and a live LangGraph→Cerebe
  call were all exercised. Versions are **pinned to verified-compatible exacts**.
- **Auth is implemented** (Clerk, graceful-optional): `requireAuth` +
  `frontend/src/lib/auth.ts` — official `@clerk/backend` + `@clerk/clerk-js`, off
  until keys are set (notes §5). Dependencies are declared but the template itself
  stays **uninstalled** (no `node_modules`/lockfile committed).
- **Code and examples must be accurate.** When extending the agent or wiring
  auth, verify the real API against the installed version. Open decisions live in
  [`docs/notes.md`](docs/notes.md).

## Conventions

- **Bun** is the runtime, package manager, and script runner. Prefer `bun` over
  `npm`/`node` in commands and docs.
- **Commit the Bun lockfile** — the Dark Factory contract requires it.
- **Secrets:** local dev reads `.env` (gitignored); prod uses Doppler. Only
  `.env.example` is committed. Never commit a real secret.
- **LLM work:** the agent's default engine is **Cerebe** (Momentiq's cognitive
  engine) via its OpenAI-compatible endpoint through `@langchain/openai`. When
  touching model ids, SDK calls, streaming, or tool use, consult the current
  Cerebe docs (https://cerebe.ai) rather than memory.

## Where to look

| Need | File |
|---|---|
| Run it / overview | [`README.md`](README.md) |
| Full walkthrough | [`docs/getting-started.md`](docs/getting-started.md) |
| Open decisions / verify list | [`docs/notes.md`](docs/notes.md) |
| Gate config explained | [`.agent-review/README.md`](.agent-review/README.md) |
| Deploy path | [`deploy/README.md`](deploy/README.md) |
