/**
 * DF Cerebe backend — HTTP entrypoint. Hono on Bun; streams agent replies over SSE.
 *
 * Auth is Clerk, graceful-optional: /api/* is gated when CLERK_SECRET_KEY is set,
 * open otherwise. The agent path (/api/chat) streams via SSE.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createMiddleware } from "hono/factory";
import { verifyToken } from "@clerk/backend";
import { runChatTurn } from "./agent/turn";
import { withHeartbeat } from "./agent/stream";
import { resolveEntityId } from "./identity";
import type { Env } from "./identity";
import { conversations } from "./routes/conversations";
import { getOrCreateConversation, appendMessage, OwnershipError } from "./db/repo";

import type { ChatRequest, ChatStreamEvent } from "@df-cerebe/shared";

const app = new Hono<Env>();

// CORS so the Vite dev server (different port) can call the API in local dev.
// TODO(prod): tighten `origin` to the deployed frontend origin.
app.use(
  "/*",
  cors({
    origin: (origin) => origin, // DEV ONLY — reflect any origin. NOT for prod.
    credentials: true,
  }),
);

// Liveness — used by the k8s deploy path and quick local sanity.
app.get("/health", (c) => c.json({ ok: true, service: "df-cerebe-backend" }));

/**
 * Clerk auth — graceful-optional. With CLERK_SECRET_KEY set, /api/* requires a
 * valid Clerk session token (`Authorization: Bearer <jwt>`); without it, auth is
 * OFF and requests pass through (dev/prototype). Uses the official
 * @clerk/backend `verifyToken`.
 */
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) {
  console.warn(
    "⚠ CLERK_SECRET_KEY not set — /api/* is UNAUTHENTICATED (open mode). " +
      "Set it (+ VITE_CLERK_PUBLISHABLE_KEY on the frontend) to enforce auth.",
  );
}

const requireAuth = createMiddleware<Env>(async (c, next) => {
  if (!CLERK_SECRET_KEY) return next(); // open mode — entityId derived as anon: below
  const authz = c.req.header("Authorization");
  const token = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : undefined;
  if (!token) return c.json({ error: "unauthorized" }, 401);
  try {
    const claims = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    // Server-derived identity — the verified `sub` becomes the memory/transcript
    // namespace. A client value can NEVER become a `user:` id (docs/design §8.2).
    if (claims.sub) c.set("entityId", `user:${claims.sub}`);
    return next();
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
});

// Conversation transcript CRUD (docs/design §7.5). requireAuth applied here so
// the sub-app's handlers see a resolved entity.
app.use("/api/conversations", requireAuth);
app.use("/api/conversations/*", requireAuth);
app.route("/api/conversations", conversations);

/** Derive a conversation title from the first user message (truncated). */
function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/**
 * POST /api/chat — the agent turn. Streams typed ChatStreamEvent JSON over SSE:
 * `token` (text) · `tool` (timeline) · `tool_progress` · `status` (heartbeat) ·
 * `done` · `error` (docs/design §5).
 *
 * Cerebe long-term memory is wired around the turn (pre-turn recall + post-turn
 * harvest) via runChatTurn — no-ops without CEREBE_API_KEY. The transcript is
 * persisted (best-effort, non-fatal): the user message before streaming, the
 * assistant message after (docs/design §7.5).
 */
app.post("/api/chat", requireAuth, async (c) => {
  const body = (await c.req.json()) as ChatRequest;

  // Scoping (docs/design §8.2): sessionId = Cerebe session / LangGraph thread
  // (client-minted when present; generated otherwise). entityId is server-derived.
  const sessionId = body.sessionId ?? crypto.randomUUID();
  const entityId = resolveEntityId(c);

  // Persist the NEW user turn before streaming (best-effort — never block chat).
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  try {
    await getOrCreateConversation({
      id: sessionId,
      ownerId: entityId,
      ...(lastUser ? { title: titleFrom(lastUser.content) } : {}),
    });
    if (lastUser) {
      await appendMessage({ conversationId: sessionId, role: "user", content: lastUser.content });
    }
  } catch (err) {
    if (!(err instanceof OwnershipError)) {
      console.warn(`[chat] persist user message failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return streamSSE(c, async (stream) => {
    const startTs = Date.now();
    let assistantText = "";
    const toolEvents: { name: string; status: "started" | "completed"; id?: string }[] = [];
    const turn = runChatTurn({ messages: body.messages, sessionId, entityId });
    try {
      for await (const ev of withHeartbeat(turn, startTs)) {
        if (ev.type === "token") assistantText += ev.delta;
        else if (ev.type === "tool") {
          toolEvents.push({ name: ev.name, status: ev.status, ...(ev.id ? { id: ev.id } : {}) });
        }
        await stream.writeSSE({ data: JSON.stringify(ev) });
      }
      const done: ChatStreamEvent = { type: "done", finishReason: "stop" };
      await stream.writeSSE({ data: JSON.stringify(done) });
    } catch (err) {
      const error: ChatStreamEvent = {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      await stream.writeSSE({ data: JSON.stringify(error) });
    } finally {
      // Persist the assistant turn (best-effort, non-fatal).
      if (assistantText.trim()) {
        try {
          await appendMessage({
            conversationId: sessionId,
            role: "assistant",
            content: assistantText,
            ...(toolEvents.length ? { toolCalls: toolEvents } : {}),
          });
        } catch (err) {
          console.warn(`[chat] persist assistant message failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  });
});

// Bun reads `port` + `fetch` off the default export.
const port = Number(process.env.PORT ?? 8787);
console.log(`df-cerebe-backend listening on :${port}`);

export default { port, fetch: app.fetch };
