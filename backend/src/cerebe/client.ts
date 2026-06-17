/**
 * Cerebe memory client — a thin, typed wrapper over `@cerebe/sdk`.
 *
 * Exposes ONLY what the agent turn needs: pre-turn `searchMemories`, post-turn
 * `harvestMemories`, and `addMemory` (used by the share/explicit-write tool).
 * Everything else in the SDK (knowledge graph, retrieval, prompts, …) is left
 * unwrapped on purpose.
 *
 * Surface verified against the real `@cerebe/sdk@0.4.0` `.d.ts` + source on
 * 2026-06-11. Notable facts baked in below:
 *   - Construction is `new Cerebe({ apiKey, project?, baseUrl? })`; the SDK reads
 *     CEREBE_API_KEY / CEREBE_PROJECT / CEREBE_BASE_URL from env as fallbacks.
 *   - `memory.harvest` takes NO `options:{enabled,max_memories}` (the Python
 *     wrapper does; the TS SDK does not) — we just ship the transcript and let
 *     Cerebe decide what's memory-worthy.
 *   - `memory.add` `importance` is a NUMBER in [0,1] (default 0.5), and
 *     `linkedEntityIds` exists — that's what a future share_memory tool needs.
 *   - Every call returns `APIResponse<unknown>` = `{ data, meta, raw }` where
 *     `data` is server-shaped and untyped, so we normalize defensively.
 *
 * ⚠ BASE-URL SEPARATION (load-bearing): the agent's chat path drives Cerebe via
 * its OpenAI-compatible endpoint at CEREBE_BASE_URL (`…/api/v1/openai/v1`). The
 * @cerebe/sdk memory client speaks the NATIVE API at `https://api.cerebe.ai`.
 * These are DIFFERENT base URLs sharing one key. We must NOT let the SDK inherit
 * CEREBE_BASE_URL (it would POST to `…/openai/v1/api/v1/memory/search`), so we
 * pass an explicit native base from CEREBE_API_BASE_URL and never fall through to
 * the SDK's CEREBE_BASE_URL default.
 */

import Cerebe from "@cerebe/sdk";
import type { MemoryType } from "@cerebe/sdk";

/** Native Cerebe API base (distinct from the OpenAI-compatible chat base). */
const CEREBE_API_BASE_URL =
  process.env.CEREBE_API_BASE_URL ?? "https://api.cerebe.ai";

let client: Cerebe | undefined;
let resolved = false;

/**
 * Lazily construct + memoize the Cerebe client. Returns `undefined` when no
 * CEREBE_API_KEY is set, so the server starts and the chat path runs without a
 * key — memory features simply no-op (see callers below).
 */
export function getCerebe(): Cerebe | undefined {
  if (resolved) return client;
  resolved = true;
  const apiKey = process.env.CEREBE_API_KEY;
  if (!apiKey) return (client = undefined); // memory no-ops without a key
  client = new Cerebe({
    apiKey,
    baseUrl: CEREBE_API_BASE_URL, // explicit native base — never inherit CEREBE_BASE_URL
    ...(process.env.CEREBE_PROJECT ? { project: process.env.CEREBE_PROJECT } : {}),
  });
  return client;
}

/** A memory normalized down to what the turn actually consumes. */
export interface RecalledMemory {
  id: string;
  content: string;
  importance?: number;
  similarityScore?: number;
}

/**
 * Normalize the untyped `APIResponse.data` from a search into a flat list. The
 * server shape isn't guaranteed by the TS types, so accept the common shapes:
 * a bare array, `{ memories: [...] }`, or `{ results: [...] }`.
 */
function normalizeMemories(data: unknown): RecalledMemory[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { memories?: unknown[] })?.memories)
      ? (data as { memories: unknown[] }).memories
      : Array.isArray((data as { results?: unknown[] })?.results)
        ? (data as { results: unknown[] }).results
        : [];
  const out: RecalledMemory[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const content = m.content;
    if (typeof content !== "string" || content.length === 0) continue;
    const id = m.id ?? m.memory_id ?? m.memoryId;
    out.push({
      id: typeof id === "string" ? id : "",
      content,
      ...(typeof m.importance === "number" ? { importance: m.importance } : {}),
      ...(typeof m.similarity_score === "number"
        ? { similarityScore: m.similarity_score }
        : typeof m.similarityScore === "number"
          ? { similarityScore: m.similarityScore }
          : {}),
    });
  }
  return out;
}

/**
 * Pre-turn recall. Returns `[]` when Cerebe is unconfigured (no key). Callers
 * treat recall as NON-FATAL — wrap in try/catch and continue the turn on error
 * (docs/design §4.4 step 4). We surface errors here rather than swallow them, so
 * the orchestrator can decide.
 */
export async function searchMemories(p: {
  query: string;
  sessionId: string;
  entityId: string;
  limit?: number;
}): Promise<RecalledMemory[]> {
  const c = getCerebe();
  if (!c) return [];
  const res = await c.memory.search({
    query: p.query,
    sessionId: p.sessionId,
    entityId: p.entityId,
    limit: p.limit ?? 5,
  });
  return normalizeMemories(res.data);
}

/**
 * Post-turn harvest — fire-and-forget. Cerebe itself decides what's
 * memory-worthy from the transcript (docs/design §2.2). No-ops without a key.
 *
 * This SWALLOWS errors internally (logs a warning): it's meant to be called
 * without `await` from a `finally` block, and an un-awaited rejection would
 * otherwise surface as an unhandledRejection. Memory loss is non-fatal to the
 * turn — the reply already streamed.
 */
export async function harvestMemories(p: {
  sessionId: string;
  entityId: string;
  transcript: { role: string; content: string }[];
}): Promise<void> {
  const c = getCerebe();
  if (!c) return;
  try {
    await c.memory.harvest({
      sessionId: p.sessionId,
      entityId: p.entityId,
      transcript: p.transcript,
    });
  } catch (err) {
    console.warn(
      `[cerebe] harvest failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Explicit memory write — backs a future `share_memory` tool (docs/design §4.3).
 * `importance` is a number in [0,1] (Cerebe default 0.5); `linkedEntityIds`
 * shares the memory with other entities' agents. Returns the new memory id when
 * the server provides one. Throws if Cerebe is unconfigured — an explicit write
 * with no key is a programming error, not a silent no-op (unlike recall/harvest).
 */
export async function addMemory(p: {
  sessionId: string;
  entityId: string;
  content: string;
  type?: MemoryType;
  importance?: number;
  linkedEntityIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ memoryId?: string }> {
  const c = getCerebe();
  if (!c) throw new Error("addMemory: CEREBE_API_KEY is not set");
  const res = await c.memory.add({
    content: p.content,
    sessionId: p.sessionId,
    entityId: p.entityId,
    ...(p.type ? { type: p.type } : {}),
    ...(p.importance !== undefined ? { importance: p.importance } : {}),
    ...(p.linkedEntityIds ? { linkedEntityIds: p.linkedEntityIds } : {}),
    ...(p.metadata ? { metadata: p.metadata } : {}),
  });
  const d = res.data as Record<string, unknown> | undefined;
  const id = d?.id ?? d?.memory_id ?? d?.memoryId;
  return typeof id === "string" ? { memoryId: id } : {};
}
