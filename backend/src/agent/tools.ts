/**
 * Agent memory tools.
 *
 * Built by a factory that CLOSURE-CAPTURES `sessionId`/`entityId` so the LLM never
 * supplies scoping ids — it only chooses the query. The prebuilt ReAct agent calls
 * `search_memories` mid-turn when prior context would help (this is on top of the
 * always-on pre-turn recall in turn.ts — the tool is for the model to recall MORE).
 *
 * `analyze_uploaded_content` remains a SKELETON (real name/schema/description,
 * throwing stub) kept OUT of the returned live array — no upload route or UI exists
 * yet. Wire it once the upload path is built (storage.analyzeContent takes
 * uploadId — see @cerebe/sdk .d.ts).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchMemories, addMemory } from "../cerebe/client";

export function makeMemoryTools(ctx: { sessionId: string; entityId: string }) {
  const search = tool(
    async ({ query, limit }) => {
      const mems = await searchMemories({
        query,
        sessionId: ctx.sessionId,
        entityId: ctx.entityId,
        limit: limit ?? 5,
      });
      // A tool must return a string (becomes the ToolMessage the model reads).
      if (!mems.length) return "No relevant memories found.";
      return mems.map((m, i) => `${i + 1}. ${m.content}`).join("\n");
    },
    {
      name: "search_memories",
      description:
        "Search the user's cross-session long-term memory for relevant context. " +
        "Use when the user refers to something from a past conversation, or when " +
        "their prior preferences/facts would improve the answer.",
      schema: z.object({
        query: z
          .string()
          .describe("What to recall — a focused natural-language query."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max memories to return (default 5)."),
      }),
    },
  );

  const IMPORTANCE_MAP: Record<string, number> = {
    low: 0.25,
    medium: 0.5,
    high: 0.85,
  };

  const shareMemory = tool(
    async ({ content, importance, linkedEntityIds }) => {
      try {
        const result = await addMemory({
          sessionId: ctx.sessionId,
          entityId: ctx.entityId,
          content,
          ...(importance ? { importance: IMPORTANCE_MAP[importance] } : {}),
          ...(linkedEntityIds?.length ? { linkedEntityIds } : {}),
        });
        return result.memoryId
          ? `Memory saved (id: ${result.memoryId}).`
          : "Memory saved.";
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        if (msg.includes("CEREBE_API_KEY")) {
          return "Memory features are not configured — CEREBE_API_KEY is not set.";
        }
        throw err;
      }
    },
    {
      name: "share_memory",
      description:
        "Save a fact, preference, or important detail to the user's long-term " +
        "memory so it persists across conversations. Use when the user explicitly " +
        "asks you to remember something, or when you learn a key fact worth keeping.",
      schema: z.object({
        content: z
          .string()
          .describe("The fact or detail to remember — one clear sentence."),
        importance: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("How important this memory is (default medium)."),
        linkedEntityIds: z
          .array(z.string())
          .optional()
          .describe("Entity ids to share this memory with (rarely needed)."),
      }),
    },
  );

  // SKELETON — no upload route or UI exists yet. Wire once the upload path is built.
  const analyzeUpload = tool(
    async (_args) => {
      throw new Error("analyze_uploaded_content: not yet wired — no upload path");
    },
    {
      name: "analyze_uploaded_content",
      description: "Analyze the user's previously uploaded content via Cerebe.",
      schema: z.object({
        uploadId: z.string(),
        context: z.string().optional(),
      }),
    },
  );
  void analyzeUpload;

  return [search, shareMemory];
}
