# Implementation Doc — Cerebe-backed agent + chat UI (lean port of the Sage blueprint)

> **Status:** design / implementation spec (not yet built).
> **Audience:** whoever implements the deep Cerebe integration in this template.
> **Source of truth studied:** `momentiq-ai/taxpilot2a` (a real product scaffolded
> from `sage-blueprint`), read directly via `gh` on 2026-06-11.
> **Target stack:** Hono + LangGraph.js + `@cerebe/sdk` (backend), Vite + Svelte
> (frontend), `@clerk/*` (auth) — i.e. this template.

This document specifies how to bring the **Cerebe-backed agentic chat** — the one
genuinely load-bearing feature of the Sage blueprint — into this lean template,
professionally and faithfully, without copying the tax-domain bulk or the dead
scaffolding that surrounds it in `taxpilot2a`.

---

## 1. Scope

**In scope (the feature):**
1. An **agent** (LangGraph.js ReAct) whose model is Cerebe (already wired in
   `backend/src/agent/graph.ts` via `ChatOpenAI` → Cerebe's OpenAI-compatible
   endpoint).
2. **Cerebe long-term memory** wired into the turn: *pre-turn* recall injected as
   context, *post-turn* harvest of new memories. Optionally an agent-callable
   `search_memories` tool for mid-turn recall.
3. A **generic chat web UI** (streaming tokens, tool/step timeline, composer) —
   the "generic web UI similar to Dark Factory's" — in Vite + Svelte.
4. A **streaming transport** carrying text, tool events, and lifecycle events.
5. **Session/entity scoping** that ties the conversation, the LangGraph thread,
   and Cerebe's memory namespace together (with an open-mode fallback for when
   Clerk auth is off).
6. A **lightweight conversation transcript store** (sidebar + reload survival) —
   `bun:sqlite` + Drizzle, distinct from Cerebe memory. See §7.5.

**Explicitly out of scope (deferred or dropped — see §9 for the evidence):**
tax-domain tools, specialist sub-agents, content-moderation guardrails, the
artifacts sandbox + generative-UI registry, skill-based tool selection, PLRE /
meta-learning, prompt-v2 enrichment, the **heavyweight** product DB stack
(Postgres + SQLAlchemy + Temporal — we keep only a 2-table SQLite transcript
store, §7.5), the Vortex knowledge store, and engagement (year-over-year)
harvesting.

---

## 2. Key findings from `taxpilot2a` (the reference)

These framed every decision below. All verified by reading the code.

1. **The live engine is tiny.** The entire orchestration is one function —
   `chat_messages()` in `backend/domains/shared/chat/api/routes.py` — driving a
   **prebuilt** LangGraph ReAct agent (`langgraph.prebuilt.create_react_agent`).
   It is *not* a hand-rolled loop or a custom graph.
2. **Cerebe memory touches the turn at exactly two points:**
   - **Pre-turn (read, sync, blocking, non-fatal):** `cerebe.memory.search(query,
     session_id, entity_id, limit=5)` → results injected into the system prompt as
     a `<memory_context>` READ-ONLY block.
   - **Post-turn (write, fire-and-forget, background):** `cerebe.memory.harvest(
     session_id, transcript, entity_id, options={enabled:true, max_memories:4})`.
     **Cerebe itself decides what's memory-worthy** from the 2-message transcript
     — the app just ships the transcript.
3. **Cerebe IS the long-term memory.** The Postgres conversation tables in
   `taxpilot2a` exist only for the **sidebar/history UI**, not for the agent's
   memory. In-turn model continuity comes from the client re-sending
   `conversation_history` each request (there is no server checkpointer in the
   live path). → **A lean port needs no database for *memory*.** (It still uses a
   small SQLite store for the *transcript/sidebar UI* — §7.5 — which is a separate
   concern from memory.)
4. **Scoping contract:** `session_id` is a **client-minted UUID** that is
   simultaneously the conversation id, the LangGraph `thread_id`, and the Cerebe
   `session_id`. `entity_id = "user:<clerk_sub>"`. Tools receive these by
   **closure** — the LLM never supplies scoping ids.
5. **Transport (in the reference) is the Vercel AI SDK "Data Stream Protocol"**
   over SSE; the reference frontend is Next.js + `@ai-sdk/react`'s `useChat`.
   *(We deliberately do NOT adopt this — we extend our own typed SSE instead; see
   §5.)*
6. **Most of the repo is inert.** Guardrails (`GuardrailService`,
   `cerebe_moderation`), the recall-connector registry, `compress_prompt`,
   `SharedAgenticContext`, specialist `base.py`, and the entire tax tool/skill
   apparatus are defined but **never invoked** in the live path, or are
   tax-specific. Don't port them.

The one piece of real safety in the live path is **prompt-injection fencing**:
all user/page-controlled context is wrapped in XML `<...>` "READ-ONLY" blocks.
Keep that.

---

## 3. Target architecture (this template)

```
 Browser (Vite + Svelte)
   ChatView  ──POST /api/v1/chat/messages (typed SSE)──────────────►  Hono backend
     ├ SSE reader (typed events → message store)                          ├ requireAuth (Clerk, optional)
     ├ smooth-stream (rAF token buffer)                                    ├ resolve sessionId + entityId
     ├ markdown renderer (incremental)                                     ├ PRE-TURN: cerebe.memory.search → <memory_context>
     ├ ToolTimeline (from data events)                                     ├ build LangGraph ReAct agent (ChatOpenAI→Cerebe)
     └ Composer (textarea, send/stop)                                      ├ stream agent.streamEvents(v2) → typed SSE events
                                                                           └ POST-TURN (finally): cerebe.memory.harvest (fire-and-forget)
                                  @cerebe/sdk  ◄── memory.search / memory.harvest / (memory.add) ──┘
```

Everything runs in the existing native `bun run dev` loop. **No new
infrastructure** — Cerebe is a hosted API; the only additions are an npm dep
(`@cerebe/sdk`) and a frontend chat dep. The ~1-minute spin-up is unchanged.

---

## 4. Backend — components

### 4.1 Cerebe client module — `backend/src/cerebe/client.ts`

A thin, typed wrapper over `@cerebe/sdk` exposing only what the agent needs.
Mirror the Python wrapper's *keyword surface* so call sites stay declarative.

As built (see the file for the full impl + doc comments):

```ts
import Cerebe from "@cerebe/sdk";
import type { MemoryType } from "@cerebe/sdk";

// Native API base — DISTINCT from the OpenAI-compatible CEREBE_BASE_URL. Passed
// explicitly so the SDK never inherits the chat base for memory calls.
const CEREBE_API_BASE_URL = process.env.CEREBE_API_BASE_URL ?? "https://api.cerebe.ai";

// Lazily constructed + memoized (incl. the undefined result) so the server starts
// without a key — memory ops no-op without one.
export function getCerebe(): Cerebe | undefined { /* new Cerebe({ apiKey, baseUrl: CEREBE_API_BASE_URL, project? }) */ }

// Pre-turn recall → normalized list ([] without a key). Non-fatal at the call site.
export async function searchMemories(p: {
  query: string; sessionId: string; entityId: string; limit?: number;
}): Promise<RecalledMemory[]> { /* c.memory.search(...) → normalizeMemories(res.data) */ }

// Post-turn harvest — fire-and-forget, swallows+logs errors (no options param in TS SDK).
export async function harvestMemories(p: {
  sessionId: string; entityId: string;
  transcript: { role: string; content: string }[];
}): Promise<void> { /* c.memory.harvest({ sessionId, entityId, transcript }) */ }

// Explicit write — backs a future share_memory tool. importance:number[0,1]; linkedEntityIds.
export async function addMemory(p: {
  sessionId: string; entityId: string; content: string;
  type?: MemoryType; importance?: number; linkedEntityIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ memoryId?: string }> { /* throws without a key; c.memory.add(...) */ }
```

> **✅ Verification gate RESOLVED (2026-06-11) — surface read from the real
> `@cerebe/sdk@0.4.0` `.d.ts` + source; the client is built at
> `backend/src/cerebe/client.ts`, type-checks, and passes runtime smoke tests.**
> What the real TS SDK actually is (vs. the Python-wrapper assumptions above):
> - **Construction:** `new Cerebe({ apiKey, project?, baseUrl? })` — `baseUrl` is
>   **camelCase**; env fallbacks `CEREBE_API_KEY/PROJECT/BASE_URL`; auth header
>   `X-API-Key` (+ `X-Cerebe-Project`). **Native API base defaults to
>   `https://api.cerebe.ai`** — distinct from the OpenAI-compatible chat base.
> - **`memory.search({ query, sessionId, entityId?, limit?, types?, minImportance? })`**
>   → POST `/api/v1/memory/search`. `minImportance` and `types` (a `MemoryType[]`)
>   **DO exist** (camelCase). The other advanced params
>   (`include_graph_context`, `temporal_scope`, `metadata_filter`, `domain_tag`)
>   are **absent** — don't pass them.
> - **`memory.harvest({ sessionId, transcript, entityId?, metadata? })`** → POST
>   `/api/v1/memory/harvest`. **There is NO `options:{enabled,max_memories}`** in
>   the TS SDK (the Python wrapper has it). We just ship the transcript; Cerebe
>   decides what's memory-worthy.
> - **`memory.add({ content, sessionId, entityId?, linkedEntityIds?, type?, importance?, metadata? })`**
>   → POST `/api/v1/memory/store`. **`importance` is a `number` in [0,1]**
>   (default 0.5), and **`linkedEntityIds` exists** — that's exactly what a future
>   `share_memory` tool needs (§4.3/§8.5).
> - Every call returns **`APIResponse<unknown>` = `{ data, meta, raw }`** — `data`
>   is server-shaped and untyped, so the client **normalizes defensively** (accepts
>   a bare array, `{ memories }`, or `{ results }`).
>
> **⚠ Base-URL separation (load-bearing, baked into the client):** the chat path
> uses `CEREBE_BASE_URL` = the OpenAI-compatible base (`…/api/v1/openai/v1`); the
> `@cerebe/sdk` memory client uses the **native** base. The SDK would otherwise
> *inherit* `CEREBE_BASE_URL` and POST to `…/openai/v1/api/v1/memory/search`
> (broken). The client passes an explicit native base from a **separate
> `CEREBE_API_BASE_URL`** env var (default `https://api.cerebe.ai`) — verified by a
> `fetch`-stub smoke test that asserts the native path. See §7.3.
>
> **Still uncrossable without credentials:** the live round-trip (does harvest
> actually persist, does a later search recall it) needs a **real Cerebe key +
> project** — §10.6. Build + type-check + call-issued are proven; the semantic
> round-trip is handed to someone with a key.

### 4.2 Agent — `backend/src/agent/graph.ts` (evolve the current single node)

Replace the single-node graph with LangGraph.js's **prebuilt ReAct agent**, same
Cerebe-backed `ChatOpenAI` we already verified:

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";   // verify import path
import { makeMemoryTools } from "./tools";

export function buildAgent(opts: { systemPrompt: string; tools: unknown[] }) {
  const model = new ChatOpenAI({
    model: process.env.LLM_MODEL ?? "gpt-4o",
    ...(process.env.CEREBE_API_KEY ? { apiKey: process.env.CEREBE_API_KEY } : {}),
    configuration: { baseURL: process.env.CEREBE_BASE_URL ?? "https://api.cerebe.ai/api/v1/openai/v1" },
    streaming: true,
  });
  return createReactAgent({
    llm: model,
    tools: new ToolNode(opts.tools, { handleToolErrors: true }),
    stateModifier: opts.systemPrompt,          // verify the exact option name for the pinned version
  });
}
```

> **✅ Verified against `@langchain/langgraph@1.4.1` (2026-06-11).** Read the real
> `react_agent_executor.d.ts`: the option is **`llm`** (not `model`); **`prompt`**
> is current (`stateModifier`/`messageModifier` are deprecated aliases);
> **`tools` accepts a plain `tool()[]` array** (no need to wrap in `ToolNode` — it
> wraps internally with `handleToolErrors`). `createReactAgent`/`ToolNode`/
> `toolsCondition` are exported from `@langchain/langgraph/prebuilt`.
> `createReactAgent` carries a "moved to the `langchain` package as `createAgent`"
> deprecation notice but is fully present/working in 1.4.1 — we use it from the
> pinned package to avoid adding a dep (one-import migration later). **As built:**
> `getModel()` (memoized ChatOpenAI→Cerebe) + a per-turn `buildAgent({ llm, tools,
> prompt })`; `runAgentTurn` streams `streamMode:"messages"` and filters the
> `tools` node so tool results never leak into the answer; `recursionLimit:25`
> bounds the loop. The single-node graph is kept (`buildSingleNodeGraph`) as the
> documented fallback.

The loop is the standard ReAct graph (`agent` ↔ `tools`), terminating when the
model emits no tool calls. Bound runaway loops with a `recursionLimit` in the
run config; map the resulting error to a friendly message.

### 4.3 Agent memory tool(s) — `backend/src/agent/tools.ts`

Optional but cheap, and it's the "agent decides to recall mid-turn" behavior.
Build tools via a factory that **closure-captures `sessionId`/`entityId`** (the
LLM never supplies them), returning native objects:

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchMemories } from "../cerebe/client";

export function makeMemoryTools(ctx: { sessionId: string; entityId: string }) {
  const search = tool(
    async ({ query, limit = 5 }) =>
      searchMemories({ query, sessionId: ctx.sessionId, entityId: ctx.entityId, limit }),
    {
      name: "search_memories",
      description: "Search the user's cross-session memories for relevant context.",
      schema: z.object({ query: z.string(), limit: z.number().optional() }),
    },
  );
  // SKELETONS — defined for structure, NOT wired into the live tool set yet.
  // share_memory + analyze_uploaded_content are a KNOWN necessary add; ship the
  // shape now so it's a drop-in once §10 confirms the @cerebe/sdk surface
  // (memory.add / storage.analyze_content + linked-entity params).
  const shareMemory = tool(
    async (_args) => { throw new Error("share_memory: not yet wired — see docs/design §4.3/§10"); },
    { name: "share_memory",
      description: "Record/share a memory with a linked entity's agent.",
      schema: z.object({ content: z.string(), importance: z.enum(["low","medium","high"]).optional() }) },
  );
  const analyzeUpload = tool(
    async () => { throw new Error("analyze_uploaded_content: not yet wired — see §4.3/§10"); },
    { name: "analyze_uploaded_content",
      description: "Analyze the user's uploaded content via Cerebe.",
      schema: z.object({}) },
  );
  void shareMemory; void analyzeUpload;          // keep skeletons referenced

  return [search];   // ← live tools. Add shareMemory / analyzeUpload here once wired.
}
```

**Decision (§8.5):** ship **`search_memories` live**, and keep **`share_memory` +
`analyze_uploaded_content` as the skeletons above** — defined (name, schema,
description, a throwing stub) but NOT in the returned live array, so the agent
can't call an unimplemented tool, yet wiring them later is a one-line add. They're
a known necessary add: implement them once §10 confirms the TS-SDK exposes the
needed `memory.add` / `storage.analyze_content` + linked-entity features.

### 4.4 The turn — `backend/src/routes/chat.ts` (Hono)

`POST /api/v1/chat/messages` — the orchestrator. Exact order is load-bearing
(mirrors the reference):

1. **Auth → identity.** `entityId = "user:" + clerkUserId` when auth is on. **Open
   mode (no Clerk):** fall back to a stable per-client id the frontend supplies
   (a `localStorage` UUID), e.g. `entityId = "anon:" + clientId`. *(Decision
   needed — see §8.)*
2. **Resolve `sessionId`** from the request body (client-minted UUID). Use it as
   the Cerebe `session_id` and the LangGraph `thread_id`.
3. **Build the system prompt** from a base persona prompt + overlays, each wrapped
   in XML READ-ONLY fences for any user/page-supplied data.
4. **Pre-turn memory recall (non-fatal):** if Cerebe is configured,
   `searchMemories({ query: message, sessionId, entityId, limit: 5 })`; append a
   `<memory_context>` READ-ONLY block to the prompt. Swallow errors.
5. **Build messages** from `conversation_history` + the new `message`
   (+ attachments later).
6. **Build the agent** (§4.2) with the prompt + memory tool(s).
7. **Stream** `agent.streamEvents(input, { version: "v2", recursionLimit })`,
   mapping events → the typed SSE events (§5), **buffering text** as you go.
8. **`finally`: post-turn harvest (fire-and-forget, non-fatal):** if the buffered
   reply is non-empty and Cerebe is configured,
   `harvestMemories({ sessionId, entityId, transcript: [user, assistant] })` in a
   non-awaited task. No-op otherwise.

Keep the path list identical to the reference so a future frontend swap is free:
`POST /api/v1/chat/messages` (SSE) — plus, **if/when** persistence is added,
`GET/POST/PATCH/DELETE /api/v1/chat/conversations[...]`.

### 4.5 Streaming — `backend/src/routes/chat-stream.ts`

Drive `agent.streamEvents(..., { version: "v2" })` and map LangGraph events to the
chosen wire protocol (§5):

| LangGraph event | Emit |
|---|---|
| `on_chat_model_stream` (text, not a tool-call chunk) | text token frame; also append to the text buffer |
| `on_tool_start` | tool-call "started" data event |
| `on_tool_end` | tool-call "completed" data event |
| stream end | finish + done frames |
| exception | error frame |

Add a **heartbeat** (~15s) so the connection survives long tool calls, and a tool
timeout signal (~300s) — both as data events.

---

## 5. The streaming transport (decision)

**Decision: keep and EXTEND this template's existing typed-SSE-JSON stream.** Do
**not** adopt the Vercel AI SDK Data Stream Protocol. Rationale:

- The current `/api/chat` already streams typed SSE
  (`{type:"token",delta}` | `{type:"done"}` | `{type:"error",message}`), verified
  working. Token streaming needs **no change**.
- The only thing the agentic UI adds is **tool/step events** — and those are a
  few extra event *types in the same stream*, not a reason to switch protocols.
- Staying typed-SSE keeps the template **dependency-free** (no `@ai-sdk/svelte`),
  **stable** (no upstream wire format that can break — the AI SDK changed its
  data-stream framing between v4 and v5), and **fully under our control**. The AI
  SDK protocol earns its keep inside the React/Next ecosystem where the blueprint
  lives; this template is Svelte and deliberately outside that ecosystem, so the
  "parity / prebuilt client" arguments don't transfer.

### Event set — extend `ChatStreamEvent` in `shared/src/index.ts`

One JSON object per SSE `data:` frame:

| `type` | Fields | Meaning |
|---|---|---|
| `token` | `delta: string` | text token delta (**existing**) |
| `tool` | `name: string`, `status: "started" \| "completed"`, `id?: string` | tool-call lifecycle — drives the timeline |
| `tool_progress` | `name: string`, `message: string` | optional sub-step note |
| `status` | `tool?: string`, `elapsedMs: number` | heartbeat / "thinking" + elapsed (keeps the connection alive during long tool calls) |
| `done` | `finishReason?: "stop" \| "tool" \| "length"` | end of turn (**existing**, now with a reason) |
| `error` | `message: string` | error (**existing**) |

Emit a `status` heartbeat ~every 15 s of silence; surface a tool-timeout
`status`/`error` past ~300 s. Response headers (unchanged from today):
`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`, `X-Content-Type-Options: nosniff`.

### Map LangGraph `streamEvents(v2)` → typed SSE (in the stream route)

| LangGraph event | Emit |
|---|---|
| `on_chat_model_stream` (text, not a tool-call chunk) | `{type:"token", delta}` + append to text buffer |
| `on_tool_start` | `{type:"tool", name, status:"started"}` |
| `on_tool_end` | `{type:"tool", name, status:"completed"}` |
| custom `tool_progress` | `{type:"tool_progress", name, message}` |
| (heartbeat timer) | `{type:"status", tool?, elapsedMs}` |
| stream end | `{type:"done", finishReason}` |
| exception | `{type:"error", message}` |

Keep the emitter in **one module** so the wire shape lives in a single place.

### If you ever DO want the AI SDK protocol

Adopt it only to interop with the Vercel AI SDK ecosystem (e.g. drop in
`@ai-sdk/svelte`'s `Chat`). Costs to weigh: an extra frontend dep + Svelte-5
compat to verify, and pinning to an AI SDK major (the **v4→v5 protocol change**
is a real maintenance liability for a long-lived template). For an internal
dashboard you almost certainly won't need it.

---

## 6. Frontend — components (Vite + Svelte)

The reference frontend is Next.js + `@ai-sdk/react` `useChat`. The genuinely
valuable, framework-agnostic parts to replicate:

1. **Stream client.** Extend the template's existing `fetch` + `ReadableStream`
   SSE reader (already in `App.svelte`) to handle the new `tool` / `tool_progress`
   / `status` events (§5) alongside `token`/`done`/`error`, accumulating into a
   small message store. **No new dependency** — it's ~30 lines of parsing.
2. **Smooth streaming.** Port the reference's `useSmoothStream`: buffer incoming
   text in a ref/store and flush to the rendered state at most once per
   `requestAnimationFrame` (~60 fps), flushing synchronously on stream end. *This
   is the single biggest perceived-quality win and is framework-agnostic.*
3. **Markdown rendering (DECIDED).** `marked` (GFM) → **`DOMPurify`** sanitize →
   Svelte `{@html}`, plus **`highlight.js`** for code blocks (a post-render pass or
   `marked` extension). **Skip** math (KaTeX) and Mermaid. Show a "Thinking…"
   placeholder while content is empty. Don't special-case incomplete markup
   mid-stream — let it **self-correct** when the closing token arrives (the rAF
   smooth-stream throttle reduces re-render churn; `marked` is fast enough at
   chat length). Lives behind one `<MarkdownMessage>` component, so it's
   swappable. *(Richer alternative if the chat UI becomes a focal feature:*
   `svelte-exmarkdown` *— component-level overrides + remark plugins, heavier;
   verify Svelte-5 compat.)* Sanitization is **load-bearing** with `{@html}` —
   never render unsanitized.
4. **Tool/step timeline.** Consume the `tool_call` / `tool_progress` / `status`
   data events into a vertical timeline (started → spinner, completed → check,
   elapsed timer, snake_case→Title-Case label humanizer). This is the "trace"
   surface and the visible proof the agent used memory/tools.
5. **Composer.** Auto-grow textarea, Enter-to-send / Shift+Enter newline, char
   counter, **animated send⇄stop** toggle wired to an `AbortController`.
6. **Message bubbles.** Role alignment, copy button, streaming-vs-settled render
   switch, light entrance animation.
7. **Session.** `sessionId` = `crypto.randomUUID()`, kept in the URL (`?c=`),
   sent as `session_id` (also the LangGraph `thread_id` + Cerebe session).
8. **Auth.** When Clerk is on, attach `Authorization: Bearer <token>` via a
   custom `fetch` wrapper (this template's `frontend/src/lib/auth.ts` already
   exposes `getToken()`).

**Skip:** the artifacts sandbox + generative-UI registry, TipTap/CodeMirror,
graph/chart libs, observability stack, slash-command/skill palettes — all heavy,
React/Next-specific, or domain-specific.

---

## 7. Data contracts

### 7.1 `POST /api/v1/chat/messages` request

```jsonc
{
  "message": "string",                  // required — the new user turn
  "session_id": "uuid",                 // required — client-minted; = thread_id = cerebe session
  "conversation_history": [             // prior turns (client-held; gives in-session continuity)
    { "role": "user|assistant", "content": "string" }
  ],
  "metadata": { }                       // optional, opaque
  // attachments[], persona, context — deferred; add if/when needed
}
```

Response: `text/event-stream` carrying the §5 frames.

### 7.2 Cerebe calls (VERIFIED against `@cerebe/sdk@0.4.0`)

```
search:  client.memory.search({ query, sessionId, entityId, limit, types?, minImportance? })
           → APIResponse{ data: <server-shaped>, meta, raw }   // normalize data defensively
harvest: client.memory.harvest({ sessionId, transcript, entityId })   // NO options param in TS SDK
add:     client.memory.add({ content, sessionId, entityId, linkedEntityIds?,
                             type?, importance? /* number 0..1 */, metadata? })
```

All three are wrapped in `backend/src/cerebe/client.ts`
(`searchMemories` / `harvestMemories` / `addMemory`) with the camelCase→snake_case
and base-URL handling done inside the SDK; callers pass plain camelCase params.

### 7.3 Environment

| Var | Required | Purpose |
|---|---|---|
| `CEREBE_API_KEY` | for memory + chat | Cerebe auth (chat already uses it) |
| `CEREBE_PROJECT` | optional | Cerebe project/tenant (sent as `X-Cerebe-Project` when set) |
| `CEREBE_BASE_URL` | no (default) | **OpenAI-compatible chat** base (`…/api/v1/openai/v1`) — chat path only |
| `CEREBE_API_BASE_URL` | no (default) | **Native** Cerebe API base (`https://api.cerebe.ai`) — memory path only |
| `LLM_MODEL` | no (default `gpt-4o`) | chat model id |

(Note: chat uses Cerebe's **OpenAI-compatible** base via `CEREBE_BASE_URL`; the
`@cerebe/sdk` memory client uses the **native** base via the separate
`CEREBE_API_BASE_URL` — two different base URLs, same key. The client passes the
native base **explicitly** so the SDK never inherits the OpenAI URL. See §4.1.)

---

## 7.5 Persistence — conversation transcript store (DECIDED)

**This stores the chat *transcript* for the UI (sidebar + survive a reload). It is
NOT the agent's memory** — Cerebe owns memory (§2.3). Two orthogonal stores joined
by `sessionId`: Cerebe holds *distilled, semantic* memories tagged with the
session; this store holds the *verbatim* messages. You cannot (and should not)
reconstruct a transcript from Cerebe memory, and you don't pollute Cerebe with raw
logs.

### Decision: `bun:sqlite` + Drizzle ORM

- **`bun:sqlite`** (built into Bun, zero dependency) as the engine, **Drizzle ORM**
  for a typed schema + queries. ~2 tables, a thin repository, the `/conversations`
  CRUD routes. No account, no network, no provisioning — keeps the 1-minute
  spin-up. Unlike Cerebe memory, this is **fully verifiable** (local DB, no key).
- **Drizzle is the load-bearing choice**: it abstracts the SQL dialect so the
  graduation below is a contained swap, not a rewrite.
- *Alternatives considered:* **none/ephemeral** (no sidebar, loses chat on reload)
  and **browser storage** (lean + stateless, but per-device, not a server source
  of truth). Server-side SQLite was chosen for a real, queryable history and the
  clean managed-DB graduation path; the one cost (stateful backend) is acceptable
  at internal-dashboard scale (one replica + a volume).

### Schema (Drizzle, `sqlite-core`)

```
conversations
  id            text  PK            -- = sessionId (client-minted UUID)
  owner_id      text  NOT NULL idx  -- "user:<clerkSub>" or "anon:<clientId>" (§8.2)
  tenant_id     text  NOT NULL idx  -- firm/org; "default" single-tenant (see note)
  title         text
  created_at    int (epoch ms)
  updated_at    int
  last_message_at int
  message_count int   DEFAULT 0
  metadata      text  (json)

messages
  id              text PK
  conversation_id text NOT NULL FK -> conversations.id ON DELETE CASCADE, idx
  role            text NOT NULL    -- "user" | "assistant"
  content         text NOT NULL    -- final rendered text
  tool_calls      text (json)      -- optional: tool/step events, to replay the timeline
  created_at      int
```

> **Include `tenant_id` from day one** even if it's `"default"`. Adding a tenant
> dimension later (for a multi-firm commercial product — e.g. HubSync's many CPA
> firms) is an extra column + filter now, a painful migration later.

### Multi-user / multi-tenant scoping (application-level, identical on any engine)

- `owner_id` = the **Clerk user id** (`"user:" + claims.sub`) — stable across
  sessions and across linked login methods (Clerk links OAuth + email by verified
  email). Open mode → `"anon:" + clientId`. The **server always derives it** (§8.2).
- **Every query is scoped** by `owner_id` (and `tenant_id`): `… WHERE owner_id = ?
  AND tenant_id = ?`; reads verify ownership before returning. SQLite stores rows;
  the app enforces isolation. Same `owner_id` that scopes Cerebe memory.

### Routes (mirror the reference paths)

`/api/v1/chat/conversations`: `GET` (list, owner-scoped), `POST` (create with the
client UUID; idempotent get-or-create), `GET /{id}/messages`, `PATCH /{id}`
(title), `DELETE /{id}`. All behind `requireAuth` when auth is on.

### Turn write path (off the request path, non-fatal)

Persist the **user message immediately**; persist the **assistant message after
the stream ends** (in `finally`, fire-and-forget) so persistence never blocks or
breaks the response. Store the final text (+ optional `tool_calls` json for
timeline replay).

### Deploy implication (the one real cost)

A `bun:sqlite` file makes the backend **stateful**: it needs a **persistent
volume** and pins you to a **single backend replica** (replicas can't share a
local file; use WAL mode for read concurrency). Fine at internal-dashboard scale
(one replica + a volume); update `deploy/k8s` with a PVC + `replicas: 1` when this
lands.

### Graduation path (commercial / horizontal scaling)

Because data access is behind Drizzle + a repository, swapping engines is contained:

- **→ Turso (libSQL) — cleanest.** libSQL *is* the SQLite dialect, so the **same
  Drizzle `sqlite-core` schema carries over**; swap the driver
  (`drizzle-orm/bun-sqlite` → `drizzle-orm/libsql`) and point at a URL. This makes
  the **backend stateless** (central networked DB, N replicas) — the
  "we-scale-horizontally / single-central-DB-with-backup" answer enterprise buyers
  ask for.
- **→ Postgres** if preferred: re-declare the schema in Drizzle `pg-core` (Postgres
  types); the repository + query shapes stay the same.

The `owner_id`/`tenant_id` scoping is **unchanged across all three engines**.

> **Verify (per template ethos):** pin `drizzle-orm` (+ `drizzle-kit` dev) to a
> verified version; `bun:sqlite` is built in. Build + type-check + a real
> create/list/get round-trip in a throwaway (no external service needed). Use
> `drizzle-kit` migrations, or `CREATE TABLE IF NOT EXISTS` on boot for the
> initial two tables.

---

## 8. Decisions (all resolved ☑)

1. ☑ **Transport — DECIDED:** keep + extend the current **typed-SSE JSON** (§5).
   The Vercel AI SDK Data Stream Protocol is explicitly **not** adopted (dep-free,
   stable, Svelte-native; the AI SDK's v4→v5 protocol churn is a liability for a
   long-lived template).
2. ☑ **Open-mode `entityId` — DECIDED:** mirror the auth posture, **server-decided**.
   Auth on → `entityId = "user:" + clerkSub` (from the verified token). Open mode
   → `entityId = "anon:" + clientId`, where `clientId` is a `localStorage` UUID the
   frontend sends. **The server always derives `entityId`** and only falls back to
   the client `anon:` id when there is NO authenticated user — it never lets a
   client value become a `user:` id (no namespace spoofing). `anon:`/`user:`
   prefixes keep namespaces disjoint. Memory works in dev without Clerk; real
   multi-user isolation arrives with auth.
3. ☑ **Persistence — DECIDED:** `bun:sqlite` + Drizzle for the conversation
   transcript store, rows scoped by `owner_id` (Clerk `sub`) + `tenant_id`,
   graduating to Turso/Postgres for stateless/horizontal scaling. Full spec in
   **§7.5**. (This is the transcript store for the UI, NOT the agent's memory —
   Cerebe owns memory.)
4. ☑ **Markdown renderer — DECIDED:** `marked` + `DOMPurify` + `{@html}` +
   `highlight.js` for code; skip math/Mermaid; let incomplete markup self-correct.
   Behind one swappable `<MarkdownMessage>` component. Details in §6.3.
5. ☑ **Agent tools — DECIDED:** ship **`search_memories` live**; include
   **`share_memory` + `analyze_uploaded_content` as skeletons** (defined but not
   in the live tool set) — a known necessary add, wired once §10 confirms the
   TS-SDK surface. Spec in §4.3.

---

## 9. What we are deliberately NOT porting (and why)

| Reference feature | Why dropped |
|---|---|
| Tax tools (`tax_tools.py`, product/client tools) | Tax-domain; not generic. |
| Specialist delegation (sub-agents) | Optional depth; recursive agent-as-tool; add later. |
| Guardrails (`GuardrailService`, `cerebe_moderation`) | **Defined but never invoked** in the live path. Optional moderation later. |
| Artifacts sandbox + generative-UI registry | Large React/security surface; tax-specific cards. |
| Skill selection (`get_tools_for_turn` 3-level) | Currently only logs; doesn't prune tools. Dead weight. |
| PLRE / meta-learning, prompt-v2 enrich | Not in the live chat path; likely absent from TS SDK. |
| The **product DB stack** (Postgres + SQLAlchemy + Alembic + Temporal) | Product machinery for relational app data + tax workflows — not needed for chat. We persist the transcript with a 2-table `bun:sqlite`+Drizzle store instead (§7.5); Cerebe remains the memory. |
| Vortex/knowledge store, engagement harvest | Tax-domain document indexing + YoY memory. |

Prompt-injection fencing (XML READ-ONLY blocks) is the **one** safety mechanism we
**do** keep.

---

## 10. Verification plan (no shortcuts)

Following this template's "verify everything against the real install" ethos:

1. ✅ **`@cerebe/sdk@0.4.x` surface — DONE (2026-06-11).** Read the real
   `.d.ts` + source. Confirmed: `memory.search`/`harvest`/`add` exist; `search`
   has `minImportance`+`types` but NOT `include_graph_context`/`temporal_scope`/
   `metadata_filter`/`domain_tag`; `harvest` has **no `options`** param;
   `add` takes `importance:number` + `linkedEntityIds`. Response `data` is
   `unknown` → client normalizes. Native base ≠ chat base → separate
   `CEREBE_API_BASE_URL`. Client passes only supported params. (Full findings in
   §4.1.)
2. **`@langchain/langgraph` prebuilt API.** Confirm `createReactAgent` +
   `ToolNode` exports and the exact option names for 1.4.x.
3. **Frontend SSE reader.** Confirm the extended `App.svelte` reader parses the
   new `tool`/`tool_progress`/`status` events alongside `token`/`done`/`error`
   (no new dep). `svelte-check` + a manual stream test.
4. **Build + type-check** the whole change (backend `tsc`, frontend
   `svelte-check`, `vite build`) in a throwaway instantiated copy.
5. **Live smoke (chat path):** already proven — the ReAct agent over Cerebe chat
   streams.
6. **Live smoke (memory path):** requires a **real Cerebe key + project**. With
   one: send a turn, confirm `memory.harvest` fires (network call succeeds);
   start a *new* session and confirm the pre-turn `memory.search` recalls it.
   *Without* a real key this is the one boundary we cannot cross — build it,
   type-check it, confirm the call is made, and hand the live round-trip to
   someone with credentials.

---

## 11. Suggested implementation phases

1. ✅ **Cerebe memory client** (`backend/src/cerebe/client.ts`) — **DONE
   (2026-06-11).** §10.1 SDK surface verified against the real `.d.ts`+source;
   client built (`getCerebe`/`searchMemories`/`harvestMemories`/`addMemory`),
   dep pinned `@cerebe/sdk@0.4.0`, `CEREBE_API_BASE_URL` added to `.env.example`.
   Backend `tsc` clean; runtime smoke proved the no-key no-op path, the native
   base-URL (trap avoided), and defensive normalization. Live semantic round-trip
   still pending a real key (§10.6).
2. ✅ **Pre-turn recall + post-turn harvest — DONE (2026-06-11).** Wired into the
   *current* single-node graph via a thin orchestrator `backend/src/agent/turn.ts`
   (`runChatTurn`): pre-turn `searchMemories` → injected as a `<memory_context>`
   READ-ONLY **system** message ahead of the user turn (non-fatal); post-turn
   `harvestMemories([user, assistant])` fire-and-forget in `finally`. Scoping
   plumbed: `sessionId` (body or generated), `entityId` server-derived
   (`user:<sub>` from the verified Clerk token, else `anon:<clientId>`); added
   `sessionId?`/`clientId?` to `ChatRequest`. All three workspaces type-check
   clean; an offline `fetch`-stub smoke proved search fires with correct scoping,
   the memory is injected ahead of the user turn, and harvest fires with the
   `[user, assistant]` transcript. (Stable per-conversation `sessionId` + real
   `clientId` from the frontend land in Phase 6; cross-session recall is
   entity-scoped so it already works.)
3. ✅ **ReAct agent + `search_memories` tool — DONE (2026-06-11).** Upgraded the
   single node to the prebuilt `createReactAgent` (verified §4.2): `getModel()`
   memoized, per-turn `buildAgent` with `makeMemoryTools({sessionId,entityId})`
   closure-bound (`backend/src/agent/tools.ts` — `search_memories` LIVE,
   `share_memory`/`analyze_uploaded_content` skeletons per §8.5). Pre-turn recall
   now rides in the system `prompt` alongside a base persona; `runAgentTurn`
   streams text-only (filters the `tools` node), `recursionLimit:25`. Backend
   `tsc` clean; offline tool-calling smoke (7/7) proved the ReAct loop, the live
   tool firing with closure scoping (LLM never supplies ids), no tool-result leak,
   pre-turn injection, and harvest.
4. ✅ **Transport — DONE (2026-06-11).** Extended `ChatStreamEvent` in `shared/`
   (`tool` / `tool_progress` / `status` / `done{finishReason}`) + an
   `AgentStreamEvent` subset. `runAgentTurn` now drives `streamEvents(v2)` and maps
   `on_chat_model_stream`→`token`, `on_tool_start/end`→`tool{started,completed,id}`.
   The route (`index.ts`) wraps the turn in `withHeartbeat`
   (`backend/src/agent/stream.ts`; `status` keepalive every `CHAT_HEARTBEAT_MS`,
   default 15s) and appends `done{finishReason:"stop"}` / `error`. All workspaces
   `tsc`/`svelte-check` clean (the existing frontend ignores unknown frame types,
   so it keeps working until Phase 5). Offline smoke (14/14): full `/api/chat` SSE
   via `app.fetch` (token assembly, tool started/completed sharing a run id,
   `done` last, no tool-result leak) + the heartbeat injection.
   (`tool_progress` is wired in the type set but not emitted yet — no tool dispatches
   custom progress; future use.)
5. ✅ **Frontend — DONE (2026-06-11).** Rebuilt `App.svelte` into a real chat UI:
   `lib/chat/stream.ts` (typed SSE reader — handles all §5 frames),
   `lib/chat/smoothStream.ts` (rAF token buffer), `lib/markdown.ts` (marked +
   DOMPurify + `{@html}` + highlight.js **common** bundle, post-render highlight),
   and components `MarkdownMessage` / `ToolTimeline` / `MessageBubble` / `Composer`
   (auto-grow, Enter-to-send, send⇄stop via AbortController). `svelte-check` clean
   + `vite build` succeeds; logic smoke (SSE split-frame parsing + smooth-stream
   batching) passing. **Lean wins:** hljs `common` (908→656 KB gz) and
   **lazy/eliminated Clerk** (`@clerk/clerk-js` dynamic-imported → open-mode build
   is **94 KB gz**). *(Browser-visual verification is the one boundary not
   crossable headlessly here — build/type/logic are proven.)*
6. ✅ **Session/entity + open-mode fallback — DONE (2026-06-11).** `lib/session.ts`
   mints + persists `sessionId` in `?c=` and `clientId` in `localStorage`; both are
   sent on every request, with a "New chat" action. The server already derives
   `entityId` (`user:<sub>` or `anon:<clientId>`) — Phase 2. (Sidebar conversation
   switching/restore arrives with the Phase 7 transcript store.)
7. ✅ **Persistence — DONE (2026-06-11).** `bun:sqlite` + Drizzle transcript store:
   `backend/src/db/{schema,client,repo}.ts` (2 tables, `CREATE TABLE IF NOT EXISTS`
   on boot, WAL + FK cascade), `routes/conversations.ts` (`/api/conversations`
   list/create/messages/rename/delete), all **owner/tenant scoped** via
   `identity.ts` (`X-Client-Id` header / verified `sub`). Turn write path wired in
   `index.ts` (user msg before stream, assistant after — best-effort). Frontend:
   `lib/chat/api.ts` + `Sidebar.svelte` + restore-on-load + conversation switching.
   `deploy/k8s` gets `backend-pvc.yaml` + `strategy: Recreate` + `DATABASE_PATH`
   on the volume. Pinned `drizzle-orm@0.45.2` (+ `drizzle-kit@0.31.10` dev). All
   workspaces `tsc`/`svelte-check` clean + `vite build`; **27 offline smokes**
   (17 repo round-trip incl. ownership isolation + cascade; 10 route/persistence
   via `app.fetch`).
8. **Live memory verification** with a real key (§10.6).

Each phase is independently shippable; phases 1–2 already deliver the core
"agent with Cerebe memory" value. Persistence (7) is additive UX and can land
anytime after the chat loop works.

---

## 12. References (taxpilot2a, branch `main`)

- `backend/domains/shared/chat/api/routes.py` — the live orchestrator (`chat_messages`)
- `backend/domains/shared/chat/services/agentic/react_agent.py` — prebuilt ReAct agent
- `backend/domains/shared/chat/sse_stream.py` + `sse_protocol.py` — streaming + wire format
- `backend/domains/shared/chat/services/agentic/memory_harvest.py` — post-turn harvest
- `backend/shared/services/cerebe_client.py` — Cerebe SDK wrapper (search/harvest/store shapes)
- `backend/domains/shared/chat/services/agentic/tools/cerebe_tools.py` — the 3 memory tools
- `web/hooks/useBaseChat.ts` — stream-consumption state machine (frontend blueprint)
- `web/hooks/useSmoothStream.ts` — rAF token buffer (port verbatim)
- `web/lib/chat/parseConversationMessages.ts` — history restore from stored SSE
- `web/components/chat/shared/{StreamingMessage,MessageBubble,ChatComposer,ToolTimeline}.tsx`

*(Dead/scaffolding, confirmed unused — do not port: `backend/shared/chat/agentic/
{memory,prompting,safety,async_guardrails,telemetry}.py`.)*
