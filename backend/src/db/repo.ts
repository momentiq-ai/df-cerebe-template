/**
 * Conversation/message repository (docs/design §7.5).
 *
 * EVERY query is scoped by owner_id (+ tenant_id): the DB stores the rows, the
 * app enforces isolation. Reads verify ownership before returning. This scoping
 * is identical across local SQLite and remote Turso — only the driver differs.
 *
 * All functions are async (libSQL is network-aware).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { conversations, messages } from "./schema";
import type { ConversationRow, MessageRow } from "./schema";

export const DEFAULT_TENANT = "default";

/** Thrown when a row exists but is owned by a different entity. */
export class OwnershipError extends Error {
  constructor() {
    super("forbidden: conversation owned by another entity");
  }
}

function now(): number {
  return Date.now();
}

/** List an owner's conversations, most-recently-updated first. */
export async function listConversations(p: {
  ownerId: string;
  tenantId?: string;
}): Promise<ConversationRow[]> {
  const tenantId = p.tenantId ?? DEFAULT_TENANT;
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerId, p.ownerId),
        eq(conversations.tenantId, tenantId),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .all();
}

/** Fetch one conversation, owner-scoped. */
export async function getConversation(p: {
  id: string;
  ownerId: string;
  tenantId?: string;
}): Promise<ConversationRow | undefined> {
  const tenantId = p.tenantId ?? DEFAULT_TENANT;
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, p.id),
        eq(conversations.ownerId, p.ownerId),
        eq(conversations.tenantId, tenantId),
      ),
    )
    .get();
}

/**
 * Idempotent get-or-create by the client-minted id. If the id already exists and
 * is owned by someone else, throws OwnershipError (no id squatting across users).
 */
export async function getOrCreateConversation(p: {
  id: string;
  ownerId: string;
  tenantId?: string;
  title?: string;
}): Promise<ConversationRow> {
  const tenantId = p.tenantId ?? DEFAULT_TENANT;
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, p.id))
    .get();
  if (existing) {
    if (existing.ownerId !== p.ownerId || existing.tenantId !== tenantId) {
      throw new OwnershipError();
    }
    return existing;
  }
  const ts = now();
  await db
    .insert(conversations)
    .values({
      id: p.id,
      ownerId: p.ownerId,
      tenantId,
      title: p.title ?? null,
      createdAt: ts,
      updatedAt: ts,
      lastMessageAt: null,
      messageCount: 0,
      metadata: null,
    })
    .run();
  return (await getConversation({ id: p.id, ownerId: p.ownerId, tenantId }))!;
}

/** Messages for a conversation, after verifying ownership. undefined = not found. */
export async function getMessages(p: {
  conversationId: string;
  ownerId: string;
  tenantId?: string;
}): Promise<MessageRow[] | undefined> {
  const convo = await getConversation({
    id: p.conversationId,
    ownerId: p.ownerId,
    ...(p.tenantId ? { tenantId: p.tenantId } : {}),
  });
  if (!convo) return undefined;
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, p.conversationId))
    .orderBy(messages.createdAt)
    .all();
}

/**
 * Rename a conversation (owner-scoped). Returns false if it doesn't exist / isn't
 * owned by this entity.
 */
export async function renameConversation(p: {
  id: string;
  ownerId: string;
  tenantId?: string;
  title: string;
}): Promise<boolean> {
  const tenantId = p.tenantId ?? DEFAULT_TENANT;
  if (!(await getConversation({ id: p.id, ownerId: p.ownerId, tenantId }))) return false;
  await db
    .update(conversations)
    .set({ title: p.title, updatedAt: now() })
    .where(and(eq(conversations.id, p.id), eq(conversations.ownerId, p.ownerId)))
    .run();
  return true;
}

/** Delete a conversation + its messages (cascade), owner-scoped. */
export async function deleteConversation(p: {
  id: string;
  ownerId: string;
  tenantId?: string;
}): Promise<boolean> {
  const tenantId = p.tenantId ?? DEFAULT_TENANT;
  if (!(await getConversation({ id: p.id, ownerId: p.ownerId, tenantId }))) return false;
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, p.id), eq(conversations.ownerId, p.ownerId)))
    .run();
  return true;
}

/**
 * Append a message and bump the conversation's counters. The conversation must
 * already exist (the turn get-or-creates it first).
 */
export async function appendMessage(p: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: unknown;
}): Promise<MessageRow> {
  const ts = now();
  const row = {
    id: crypto.randomUUID(),
    conversationId: p.conversationId,
    role: p.role,
    content: p.content,
    toolCalls: p.toolCalls === undefined ? null : JSON.stringify(p.toolCalls),
    createdAt: ts,
  };
  return db.transaction(async (tx) => {
    await tx.insert(messages).values(row).run();
    await tx
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        lastMessageAt: ts,
        updatedAt: ts,
      })
      .where(eq(conversations.id, p.conversationId))
      .run();
    return row;
  });
}
