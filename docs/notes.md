# Notes — open decisions & verification checklist

This file is the single place that collects everything in the scaffold marked
`NOTE(verify)`, `TODO`, or "decide first". It exists because the first draft was
written **without installing dependencies** (by design) and with deliberate care
not to assert versions or framework APIs that drift. Work through this before
treating the template as production-ready.

Legend: ☐ open · ☑ resolved.

---

## 1. Dependency versions are placeholders (verify before first install)

☑ **RESOLVED 2026-06-11.** All workspace deps are now PINNED EXACTLY to current
published versions, and the set was **peer-verified mutually compatible** via
`npm view <pkg> peerDependencies` (no install — the template stays uninstalled).

| Package | Where | Pinned |
|---|---|---|
| `hono` | backend | `4.12.25` |
| `@langchain/langgraph` | backend | `1.4.1` |
| `@langchain/core` | backend | `1.1.48` (langgraph + openai peer `^1.1.4x`) |
| `@langchain/openai` | backend | `1.4.7` — drives Cerebe's OpenAI-compatible endpoint (§4) |
| `@cerebe/sdk` | backend | `0.4.0` — Cerebe memory client (native API); surface verified, Phase 1 (§15) |
| `drizzle-orm` | backend | `0.45.2` — typed SQLite (bun:sqlite) transcript store (§15 Phase 7) |
| `drizzle-kit` | backend (dev) | `0.31.10` — migrations tool (optional; boot uses CREATE TABLE IF NOT EXISTS) |
| `zod` | backend | `4.4.3` — **new required peer of langgraph 1.x** (was missing) |
| `@clerk/backend` | backend | `3.6.1` (engine: node ≥ 20.9) |
| `svelte` | frontend | `5.56.3` |
| `vite` | frontend | `8.0.16` (engine: node `^20.19.0 \|\| >=22.12.0` — the strictest in the set) |
| `@sveltejs/vite-plugin-svelte` | frontend | `7.1.2` (peers: svelte `^5.46.4`, vite `^8`) |
| `svelte-check` | frontend | `4.6.0` |
| `marked` | frontend | `18.0.5` — GFM markdown → HTML (chat rendering) |
| `dompurify` | frontend | `3.4.9` — sanitize before `{@html}` (load-bearing) |
| `highlight.js` | frontend | `11.11.1` — code highlighting (`/lib/common` bundle) |
| `typescript` | all | `6.0.3` |
| `bun-types` | root (hoisted) | `1.3.14` — added; `tsconfig.base.json` references it |
| `husky` | root | `9.1.7` |
| `@momentiq/dark-factory-cli` | root | `2.5.0` (confirmed published; gate-contract exact pin) |

Consequences applied this pass:
- Root `engines.node` bumped to `^20.19.0 || >=22.12.0` (Vite 8's floor; also
  satisfies Clerk's ≥20.9 and hono's ≥16.9). Advisory — dev runs on Bun.
- `zod@4.4.3` added to the backend (hard peer of langgraph 1.x). The optional
  `zod-to-json-schema` peer was **not** added (declared `optional: true`).

> **Lockfile note (template vs instantiated project):** this TEMPLATE commits NO
> lockfile (it is never installed — see WORK_LOG_02 D-TEMPLATE). The Dark Factory
> "commit the lockfile" rule applies to the **project created from** the template:
> after its first `bun install`, commit `bun.lock` so its CI pins match.

## 2. Skeleton APIs are directional, not verified — now HIGHER risk  ☐

☑ **RESOLVED 2026-06-11 — verified against the pinned majors by a real install.**
A throwaway instantiated copy was `bun install`ed and exercised end to end. The
agent (`graph.ts`/`index.ts`) and the streaming chat frontend (`App.svelte`) are
now **implemented and confirmed working**:

- ☑ `StateGraph`, `MessagesAnnotation`, `START`, `END` are exported by
  `@langchain/langgraph@1.4.1` (the skeleton's names were right for 1.x).
- ☑ Streaming via `graph.stream(input, { streamMode: "messages" })` yields
  `[messageChunk]` tuples; `runAgentTurn` pulls text deltas and the SSE handler
  forwards them. Verified live against **Cerebe** (§4): `/api/chat` streamed a
  real completion token-by-token.
- ☑ The chat model is `ChatOpenAI` pointed at Cerebe's OpenAI-compatible endpoint
  (see §4). The Cerebe API key is passed explicitly only when set
  (`...(apiKey ? { apiKey } : {})`) to satisfy `exactOptionalPropertyTypes`.

**Two fixes the install surfaced (now applied to the template):**
1. `backend/tsconfig.json` — removed `rootDir: "src"` (it rejected the
   cross-workspace `@df-cerebe/shared` import as outside rootDir; TS6059).
2. `graph.ts` — drop the explicit `apiKey` (see above).

All three workspaces type-check clean and the frontend `vite build` passes.
Remaining API-verification item: **Clerk auth is still unimplemented** — see §5.

## 3. Model selection  ☐

The agent talks to **Cerebe** (§4), which takes **OpenAI-style model ids** and
routes by capability behind them. Default is `LLM_MODEL=gpt-4o` (verified working
in a live call). Cerebe's docs also reference capability tiers (e.g. GPT-5 /
GPT-5 Mini). ☐ Pick the id/tier you want and align `.env.example` +
`deploy/k8s/base/backend-deployment.yaml` (`graph.ts` reads `LLM_MODEL`, so it
needs no change).

## 4. Cerebe is the default engine  ☑

☑ **IMPLEMENTED + VERIFIED LIVE 2026-06-11.** The agent defaults to **Cerebe**
(Momentiq's cognitive engine, like the original Sage stack), not raw Anthropic.

- **How:** Cerebe exposes an **OpenAI-compatible** chat endpoint, so `graph.ts`
  drives it via `@langchain/openai`'s `ChatOpenAI` pointed at
  `CEREBE_BASE_URL` (default `https://api.cerebe.ai/api/v1/openai/v1`) with
  `CEREBE_API_KEY`. This keeps LangGraph's token streaming intact.
- **Verified:** with the real base URL, `/api/chat` streamed a live completion
  token-by-token (`{"type":"token","delta":"The"} …`). Base URL + streaming both
  confirmed against the running endpoint.
- **Cerebe's deeper features** (memory, knowledge graph, RAG, meta-learning) are
  in `@cerebe/sdk` — NOT wired yet. Add them as real features later; the chat
  path alone uses the OpenAI-compatible endpoint.
- **To use raw Anthropic instead:** `bun add @langchain/anthropic`, swap
  `ChatOpenAI` → `ChatAnthropic` in `graph.ts` (drop the `configuration`/Cerebe
  bits, read `ANTHROPIC_API_KEY`), set `ANTHROPIC_API_KEY` + an Anthropic
  `LLM_MODEL` (e.g. `claude-sonnet-4-6`).

## 5. Clerk auth  ☑

☑ **DECIDED + IMPLEMENTED + VERIFIED 2026-06-11.** There is **no official
`@clerk/svelte`** package — so we used the official framework-agnostic
`@clerk/clerk-js@6.16.0` directly (Svelte is just JS; the community `svelte-clerk`
was rejected — trusting a third party for security-sensitive auth isn't worth the
saved lines). Backend uses official `@clerk/backend@3.6.1`.

**Graceful-optional design:**
- Backend `requireAuth` (`backend/src/index.ts`): if `CLERK_SECRET_KEY` is set,
  `/api/*` requires a valid `Authorization: Bearer <jwt>` (verified with
  `verifyToken`), else 401. If unset → open mode + a loud startup warning.
- Frontend (`frontend/src/lib/auth.ts` + `main.ts`): if
  `VITE_CLERK_PUBLISHABLE_KEY` is set, gate behind `clerk.mountSignIn` and attach
  `session.getToken()` to `/api/chat`. If unset → app mounts open.

Verified: open mode passes through + warns; enforced mode returns 401 on
missing/bogus tokens; all type-checks + the frontend build pass. (A *successful*
sign-in needs a real Clerk instance — your keys — same boundary as a live Claude
completion.) Note: `clerk-js` is large (~bundle >500 kB warning); fine for a
dashboard, code-split later if it matters.

## 6. Bun compatibility for the LangChain dependency tree  ☑

☑ **VERIFIED 2026-06-11.** `bun install` (Bun 1.3.14) resolved the full tree —
698 packages including the LangChain/LangGraph stack — with no errors, and the
agent path RAN under Bun: the server started, `/api/chat` executed the graph, and
the LangChain → Anthropic HTTP call went out cleanly (returned a real auth error
on the fake key). No unimplemented-Node-API issue surfaced on the happy path.

Fallback (kept for reference, not needed): if some dep ever misbehaves under Bun,
run **the backend** under Node via `@hono/node-server`'s `serve(...)` instead of
`export default { port, fetch }`. Frontend/tooling stay on Bun. One-file change.

## 7. Node vs Bun  ☑ (documented)

Bun runs the app; Node is not required for dev. The Dark Factory CLI is a
self-contained Node-targeted bundle that Bun executes fine. Node only re-enters
the picture as the §6 fallback. No action unless §6 fires.

## 8. Deploy: kustomize vs Helm  ☐

`deploy/k8s/base/` uses plain manifests + kustomize (lighter, no templating
language). ☐ If your target cluster's tooling standardizes on Helm, convert the
base to a chart — mechanical. Decision left to whoever owns the cluster.

## 9. Deploy: secrets into Kubernetes  ☐

`backend-deployment.yaml` reads secrets from a `df-cerebe-secrets` Secret created
out-of-band. ☐ Choose: `kubectl create secret` by hand, or the **Doppler
Kubernetes operator** to keep Doppler the single source of truth in prod too.

## 10. Frontend ↔ backend routing in prod  ☐

Two valid shapes, ☐ pick one:

- **Same host** (current `ingress.yaml`): `/api` → backend Service, `/` → frontend.
- **Split hosts**: frontend at `app.df-cerebe.example`, backend at
  `api.df-cerebe.example`; the SPA calls the backend via `VITE_API_BASE_URL` (baked
  at build). Drop the `/api` ingress rule if you go this way.

Also ☐ confirm SSE streaming passes cleanly through your chosen ingress
controller (some buffer responses by default and break token streaming).

## 11. Hosted CI gate (W3 critic + Check Run) — NOT wired  ☐

Only the **local** Dark Factory gate is set up. The hosted layer (a Check Run on
PRs) is an additional opt-in. The **how-to is now written** — see
[`getting-started.md` › Appendix — Enabling the hosted gate](getting-started.md#appendix--enabling-the-hosted-gate-opt-in).
It covers both paths (W3 hosted App vs self-hosted CI workflow), the
template-specific gotchas (reference your own fork's reusable workflow; omit
`cycle-doc-validation`), and the binding ruleset. Per-project wiring still ☐ —
the local gate is sufficient for solo/early work; add this before multi-author
merges. Authoritative source: `CONSUMER-ADOPTION.md` §8–§10.

## 12. Strengthen the local quorum  ☐

`.agent-review/config.json` sets `profiles.local.quorum: 1` (one critic suffices)
so the gate works with a single subscription. ☐ Once both Cursor **and** Codex
are authenticated, bump to `2` for stronger local signal.

## 13. Docker-build evidence shim — skeleton only  ☐

`scripts/check-dockerfile.sh` is a documented skeleton, **not** wired into
`pre-push`. Commits touching `deploy/docker/*` get a harmless
`requiresHumanJudgment` critic finding until you implement and wire it. ☐ Wire it
only when you start iterating on the Dockerfiles and want clean signal.

## 14. Husky activation under Bun  ☑

☑ **VERIFIED 2026-06-11.** `bun install` ran the root `prepare: "husky"` script
(`$ husky` appeared in the install output) and armed the hooks: `git config
core.hooksPath` returned `.husky/_`. So Bun DOES run the root project's `prepare`
lifecycle on install — no fallback needed. The gate goes live automatically on
the first `bun install`, exactly as designed.

- Reminder: hooks are **dormant from clone until the first `bun install`** — this
  is why the template's own first commit was un-gated (expected).

## 15. Deep Cerebe integration (agent memory + chat UI)  ☐

The current agent uses Cerebe for **chat only**. The deeper integration wires
Cerebe **memory** into the turn (pre-turn recall + post-turn harvest) behind a
ReAct agent, plus a richer chat UI — the template's headline feature. The
progress log below tracks the phases that are done.

**Progress:** ☑ **Phase 1 done (2026-06-11)** — `@cerebe/sdk@0.4.0` surface
verified against the real `.d.ts`+source, Cerebe memory client built at
`backend/src/cerebe/client.ts` (`getCerebe`/`searchMemories`/`harvestMemories`/
`addMemory`), `CEREBE_API_BASE_URL` added (native base ≠ chat base).
☑ **Phase 2 done (2026-06-11)** — memory wired around the turn via
`backend/src/agent/turn.ts` (`runChatTurn`): pre-turn recall injected as a
`<memory_context>` system message, post-turn harvest fire-and-forget; `sessionId`/
`entityId` plumbed (server-derived identity in `index.ts`).
☑ **Phase 3 done (2026-06-11)** — upgraded to the prebuilt `createReactAgent`
(verified `@langchain/langgraph@1.4.1` surface) + live `search_memories` tool
(`backend/src/agent/tools.ts`; share/analyze skeletons); pre-turn recall rides in
the system prompt, text-only streaming filters the tools node.
☑ **Phase 4 done (2026-06-11)** — typed-SSE transport extended (`tool`/
`tool_progress`/`status`/`done{finishReason}` + `AgentStreamEvent`);
`runAgentTurn` drives `streamEvents(v2)` → token+tool frames; route adds a
`withHeartbeat` keepalive (`backend/src/agent/stream.ts`) + done/error.
☑ **Phases 5+6 done (2026-06-11)** — real chat UI: typed SSE reader, rAF
smooth-stream, markdown (marked + DOMPurify + `{@html}` + highlight.js common),
`MarkdownMessage`/`ToolTimeline`/`MessageBubble`/`Composer`, session/clientId
plumbing (`?c=` + localStorage) + "New chat". Lean wins: hljs common + lazy Clerk
→ open-mode build **94 KB gz**.
☑ **Phase 7 done (2026-06-11)** — `bun:sqlite` + Drizzle transcript store
(`backend/src/db/*`), `/api/conversations` CRUD (`routes/conversations.ts`),
owner/tenant scoping (`identity.ts`, `X-Client-Id`), turn write path, frontend
sidebar + restore (`lib/chat/api.ts`, `Sidebar.svelte`); `deploy/k8s` PVC +
Recreate + `DATABASE_PATH`. All workspaces clean + 27 offline smokes. ☐ Phase 8
(live-key memory round-trip).

---

## Suggested order once you're ready to leave "draft"

1. ☑ §1 versions pinned · ☑ §2 agent implemented + verified · ☑ §6 Bun-compat ·
   ☑ §14 husky-arm (all done 2026-06-11 via a real throwaway install).
2. §3 pick the model id default (sonnet-4-6 currently).
3. §5 Clerk auth — pick the Svelte integration, confirm **3.x** `verifyToken`.
   (The one remaining app stub.)
4. §11/§12 strengthen the gate.
5. Deploy path (`deploy/README.md`) + §8–§10 when you ship.
