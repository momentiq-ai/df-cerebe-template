/**
 * @df-cerebe/shared — the contract between backend and frontend.
 *
 * This is the concrete payoff of running TypeScript on both sides: define a
 * shape once, import it in `backend/` AND `frontend/`. Change a field and the
 * compiler flags every call site on both ends. SKELETON — extend as the
 * dashboard's API grows.
 */

/** A single chat turn in the agent conversation. */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Body of POST /api/chat. */
export interface ChatRequest {
  messages: ChatMessage[];
  /** Optional client-chosen model override; backend falls back to LLM_MODEL. */
  model?: string;
  /**
   * Client-minted conversation id (UUID). Doubles as the Cerebe `session_id` and
   * the LangGraph `thread_id`. Optional — the backend generates one when absent.
   * Cross-session memory is scoped by entity, so recall still works without it.
   * (docs/design §6.7, §8.2)
   */
  sessionId?: string;
}

/**
 * Open-mode identity is carried in the `X-Client-Id` header (a stable per-browser
 * localStorage UUID) on every API request — chat AND conversation CRUD. The
 * server derives `entityId = "anon:" + clientId` when Clerk auth is off, and
 * `"user:" + clerkSub` (from the verified token) when it's on — a client value
 * can NEVER become a `user:` id. (docs/design §8.2)
 */
export const CLIENT_ID_HEADER = "X-Client-Id";

/** A conversation as listed in the sidebar (GET /api/conversations). */
export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  lastMessageAt: number | null;
  messageCount: number;
}

/** A stored transcript message (GET /api/conversations/:id/messages). */
export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: unknown;
}

/**
 * One Server-Sent Event the backend streams during a chat turn (typed-SSE-JSON,
 * one JSON object per `data:` frame — docs/design/cerebe-agent-and-chat.md §5).
 * NOTE: keep this in sync with what the backend writes and what the frontend
 * parses — that sync is exactly what this package buys you.
 */
export type ChatStreamEvent =
  /** Text token delta (the assistant's answer). */
  | { type: "token"; delta: string }
  /** Tool-call lifecycle — drives the UI's tool/step timeline. */
  | { type: "tool"; name: string; status: "started" | "completed"; id?: string }
  /** Optional sub-step note emitted from inside a tool (future use). */
  | { type: "tool_progress"; name: string; message: string }
  /** Heartbeat / "thinking" keepalive with elapsed time (survives long tool calls). */
  | { type: "status"; tool?: string; elapsedMs: number }
  /** End of the turn. */
  | { type: "done"; finishReason?: "stop" | "tool" | "length" }
  /** Terminal error. */
  | { type: "error"; message: string };

/**
 * The subset of events the agent generator yields (content events). Lifecycle
 * frames (`status` heartbeat, `done`, `error`) are added by the SSE route.
 */
export type AgentStreamEvent = Extract<
  ChatStreamEvent,
  { type: "token" | "tool" | "tool_progress" }
>;
