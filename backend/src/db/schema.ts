/**
 * Conversation transcript schema (docs/design/cerebe-agent-and-chat.md §7.5).
 *
 * This stores the chat TRANSCRIPT for the UI (sidebar + survive a reload). It is
 * NOT the agent's memory — Cerebe owns memory. Two orthogonal stores joined by
 * sessionId: Cerebe holds distilled semantic memories; this holds verbatim turns.
 *
 * Drizzle `sqlite-core` schema → carries over to Turso/libSQL unchanged, and to
 * Postgres by re-declaring in `pg-core` (the repository + queries stay the same).
 * `tenant_id` is present from day one (default "default") so a multi-firm product
 * is a filter change, not a migration.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(), // = sessionId (client-minted UUID)
    ownerId: text("owner_id").notNull(), // "user:<sub>" | "anon:<clientId>"
    tenantId: text("tenant_id").notNull().default("default"),
    title: text("title"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastMessageAt: integer("last_message_at"),
    messageCount: integer("message_count").notNull().default(0),
    metadata: text("metadata"), // json
  },
  (t) => ({
    ownerIdx: index("conversations_owner_idx").on(t.ownerId, t.tenantId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    toolCalls: text("tool_calls"), // json — optional timeline replay
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    conversationIdx: index("messages_conversation_idx").on(t.conversationId),
  }),
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
