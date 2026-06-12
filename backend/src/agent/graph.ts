/**
 * DF Cerebe agent runtime — LangGraph.js prebuilt ReAct agent + Cerebe.
 *
 * Cerebe exposes an OpenAI-compatible chat endpoint, so we drive it through
 * @langchain/openai's ChatOpenAI pointed at the Cerebe base URL. The agent is the
 * prebuilt ReAct loop (createReactAgent: `agent` ↔ `tools`, terminating when the
 * model emits no tool calls), with memory tools bound per turn (docs/design §4.2).
 * To use raw Anthropic instead, see docs/notes.md §4.
 *
 * NOTE: `createReactAgent` is re-homed to the `langchain` package as `createAgent`
 * in newer releases; we use it from the PINNED `@langchain/langgraph@1.4.1`
 * prebuilt (verified present) to avoid adding another dependency. Migration is a
 * one-import swap if/when we adopt the `langchain` package.
 *
 * STREAMING CAVEAT: Cerebe's OpenAI-compatible endpoint drops tool_calls metadata
 * from streaming responses (the chunks arrive with empty content and no
 * additional_kwargs). Non-streaming responses include tool_calls correctly. We use
 * a two-model strategy: stream for text-only turns (fast UX), fall back to
 * non-streaming invoke() when an empty-content stream signals a dropped tool call.
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatMessage, AgentStreamEvent } from "@df-cerebe/shared";

const CEREBE_BASE_URL =
  process.env.CEREBE_BASE_URL ?? "https://api.cerebe.ai/api/v1/openai/v1";

/** Bound the ReAct loop so a misbehaving model can't spin forever. */
const RECURSION_LIMIT = 25;

let streamingModel: ChatOpenAI | undefined;
function getStreamingModel(): ChatOpenAI {
  if (streamingModel) return streamingModel;
  const apiKey = process.env.CEREBE_API_KEY;
  streamingModel = new ChatOpenAI({
    model: process.env.LLM_MODEL ?? "gpt-4o",
    ...(apiKey ? { apiKey } : {}),
    configuration: { baseURL: CEREBE_BASE_URL },
    streaming: true,
  });
  return streamingModel;
}

let nonStreamingModel: ChatOpenAI | undefined;
function getNonStreamingModel(): ChatOpenAI {
  if (nonStreamingModel) return nonStreamingModel;
  const apiKey = process.env.CEREBE_API_KEY;
  nonStreamingModel = new ChatOpenAI({
    model: process.env.LLM_MODEL ?? "gpt-4o",
    ...(apiKey ? { apiKey } : {}),
    configuration: { baseURL: CEREBE_BASE_URL },
    streaming: false,
  });
  return nonStreamingModel;
}

function buildStreamingAgent(opts: { tools: ReturnType<typeof import("./tools").makeMemoryTools>; systemPrompt?: string }) {
  return createReactAgent({
    llm: getStreamingModel(),
    tools: opts.tools,
    ...(opts.systemPrompt ? { prompt: opts.systemPrompt } : {}),
  });
}

function buildNonStreamingAgent(opts: { tools: ReturnType<typeof import("./tools").makeMemoryTools>; systemPrompt?: string }) {
  return createReactAgent({
    llm: getNonStreamingModel(),
    tools: opts.tools,
    ...(opts.systemPrompt ? { prompt: opts.systemPrompt } : {}),
  });
}

function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}

function extractText(msg: BaseMessage): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}

/**
 * Run one turn through the ReAct agent, yielding typed AGENT events
 * (token | tool | tool_progress — docs/design §4.5/§5).
 *
 * Primary path: streamEvents(v2) for token-by-token text streaming.
 * Fallback: when streaming yields zero text (Cerebe dropped a tool call's
 * metadata), re-run via invoke() on a non-streaming model so the full ReAct
 * loop executes (model → tool → model). The final text is emitted as one chunk.
 */
export async function* runAgentTurn(opts: {
  messages: ChatMessage[];
  tools: ReturnType<typeof import("./tools").makeMemoryTools>;
  systemPrompt?: string;
}): AsyncGenerator<AgentStreamEvent> {
  const inputMessages = opts.messages.map((m) => ({ role: m.role, content: m.content }));

  // --- Primary path: streaming ---
  const streamingAgent = buildStreamingAgent({ tools: opts.tools, ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}) });
  const events = streamingAgent.streamEvents(
    { messages: inputMessages },
    { version: "v2", recursionLimit: RECURSION_LIMIT },
  );

  let emittedText = false;
  let lastToolResult = "";
  let hadEmptyChunks = false;

  for await (const ev of events) {
    if (ev.event === "on_chat_model_stream") {
      const cnt = (ev.data as { chunk?: { content?: unknown } })?.chunk?.content;
      const text = chunkText(cnt);
      if (text) {
        emittedText = true;
        yield { type: "token", delta: text };
      } else if (cnt === "" || cnt === null) {
        hadEmptyChunks = true;
      }
    } else if (ev.event === "on_tool_start") {
      yield { type: "tool", name: ev.name, status: "started", id: ev.run_id };
    } else if (ev.event === "on_tool_end") {
      const output = (ev.data as { output?: unknown })?.output;
      const text =
        typeof output === "string"
          ? output
          : typeof (output as { content?: unknown })?.content === "string"
            ? ((output as { content: string }).content)
            : "";
      if (text) lastToolResult = text;
      yield { type: "tool", name: ev.name, status: "completed", id: ev.run_id };
    }
  }

  // Streaming worked — emit tool result fallback if needed and return.
  if (emittedText) return;
  if (lastToolResult) {
    yield { type: "token", delta: lastToolResult };
    return;
  }

  // --- Fallback: non-streaming invoke (Cerebe dropped tool call from stream) ---
  if (!hadEmptyChunks) return; // genuinely empty response, not a dropped tool call

  const agent = buildNonStreamingAgent({ tools: opts.tools, ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}) });
  const result = await agent.invoke(
    { messages: inputMessages },
    { recursionLimit: RECURSION_LIMIT },
  );

  const msgs: BaseMessage[] = result.messages;
  const last = msgs[msgs.length - 1];
  if (last) {
    // Yield tool events for any tool calls that happened during invoke.
    for (const msg of msgs) {
      const type = (msg as { _getType?: () => string })._getType?.();
      if (type === "tool") {
        const name = (msg as { name?: string }).name ?? "tool";
        yield { type: "tool", name, status: "completed", id: "" };
      }
    }
    const text = extractText(last);
    if (text) {
      yield { type: "token", delta: text };
    }
  }
}
