/**
 * Database connection — @libsql/client + Drizzle.
 *
 * libSQL supports both local SQLite files (file:./df-cerebe.db) and remote Turso
 * databases (libsql://your-db.turso.io). One driver, one code path:
 *
 *   LOCAL DEV:   DATABASE_URL=file:./df-cerebe.db  (default, no token needed)
 *   TURSO/PROD:  DATABASE_URL=libsql://...      TURSO_AUTH_TOKEN=...
 *
 * Schema and all Drizzle queries are unchanged from the bun:sqlite era — only
 * the driver is different (and everything is async now).
 *
 * Tables are created on boot with CREATE TABLE IF NOT EXISTS (design §7.5 allows
 * this over drizzle-kit migrations for the initial two tables). drizzle-kit is
 * available as a dev dep for when you want real migrations.
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./df-cerebe.db";

const client = createClient({
  url: DATABASE_URL,
  ...(process.env.TURSO_AUTH_TOKEN
    ? { authToken: process.env.TURSO_AUTH_TOKEN }
    : {}),
});

// PRAGMAs that change journal mode cannot run inside a transaction (batch() wraps
// in one), so execute them individually first.
await client.execute("PRAGMA journal_mode = WAL;");
await client.execute("PRAGMA foreign_keys = ON;");

// DDL mirrors db/schema.ts. Keep the two in sync (or graduate to drizzle-kit).
// batch() sends all statements in one round-trip (matters for remote Turso).
await client.batch([
  `CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    title           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_message_at INTEGER,
    message_count   INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS conversations_owner_idx
    ON conversations (owner_id, tenant_id);`,
  `CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    tool_calls      TEXT,
    created_at      INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages (conversation_id);`,
]);

export const db = drizzle(client, { schema });
export { schema };
