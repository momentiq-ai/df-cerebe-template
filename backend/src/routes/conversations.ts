/**
 * Conversation transcript CRUD (docs/design §7.5).
 *
 * A Hono sub-app mounted at /api/conversations. requireAuth is applied at the
 * mount, so `entityId` is already resolved. Every handler scopes by the resolved
 * entity — a user only ever sees/edits their own conversations.
 *
 * (Path note: the reference uses /api/v1/chat/conversations; we mirror our own
 * flat /api/chat with /api/conversations. Same shapes, owner-scoped.)
 */

import { Hono } from "hono";
import { resolveEntityId } from "../identity";
import type { Env } from "../identity";
import {
  listConversations,
  getOrCreateConversation,
  getMessages,
  renameConversation,
  deleteConversation,
  OwnershipError,
} from "../db/repo";
import type { ConversationRow, MessageRow } from "../db/schema";
import type { ConversationSummary, StoredMessage } from "@df-cerebe/shared";

function toSummary(r: ConversationRow): ConversationSummary {
  return {
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt,
    lastMessageAt: r.lastMessageAt,
    messageCount: r.messageCount,
  };
}

function toStored(m: MessageRow): StoredMessage {
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    ...(m.toolCalls ? { toolCalls: JSON.parse(m.toolCalls) } : {}),
  };
}

export const conversations = new Hono<Env>();

// List the entity's conversations (most-recent first).
conversations.get("/", async (c) => {
  const ownerId = resolveEntityId(c);
  const rows = await listConversations({ ownerId });
  return c.json(rows.map(toSummary));
});

// Idempotent get-or-create by client-minted id.
conversations.post("/", async (c) => {
  const ownerId = resolveEntityId(c);
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; title?: string };
  if (!body.id) return c.json({ error: "id required" }, 400);
  try {
    const row = await getOrCreateConversation({
      id: body.id,
      ownerId,
      ...(body.title ? { title: body.title } : {}),
    });
    return c.json(toSummary(row));
  } catch (err) {
    if (err instanceof OwnershipError) return c.json({ error: "forbidden" }, 403);
    throw err;
  }
});

// Messages for one conversation (owner-scoped; 404 if not yours / missing).
conversations.get("/:id/messages", async (c) => {
  const ownerId = resolveEntityId(c);
  const rows = await getMessages({ conversationId: c.req.param("id"), ownerId });
  if (rows === undefined) return c.json({ error: "not found" }, 404);
  return c.json(rows.map(toStored));
});

// Rename.
conversations.patch("/:id", async (c) => {
  const ownerId = resolveEntityId(c);
  const body = (await c.req.json().catch(() => ({}))) as { title?: string };
  if (typeof body.title !== "string") return c.json({ error: "title required" }, 400);
  const okUpdate = await renameConversation({ id: c.req.param("id"), ownerId, title: body.title });
  return okUpdate ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// Delete (cascades to messages).
conversations.delete("/:id", async (c) => {
  const ownerId = resolveEntityId(c);
  const okDelete = await deleteConversation({ id: c.req.param("id"), ownerId });
  return okDelete ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});
