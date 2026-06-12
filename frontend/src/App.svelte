<script lang="ts">
  /**
   * DF Cerebe dashboard — agent chat surface (docs/design §6 + §7.5).
   *
   * Streams typed SSE events from POST /api/chat and renders them; persists +
   * restores transcripts via /api/conversations (sidebar + reload survival).
   *   token → smooth-streamed markdown · tool → timeline · status → "thinking…"
   *   done/error → settle. Stop wired to AbortController. sessionId (?c=) +
   *   clientId (X-Client-Id) scope every request.
   */
  import { onMount } from "svelte";
  import type { ChatRequest, ConversationSummary, StoredMessage } from "@df-cerebe/shared";
  import { getToken } from "./lib/auth";
  import { streamChat } from "./lib/chat/stream";
  import { SmoothStreamer } from "./lib/chat/smoothStream";
  import {
    listConversations,
    getConversationMessages,
    deleteConversation as apiDelete,
  } from "./lib/chat/api";
  import { getSessionId, getClientId, newSession } from "./lib/session";
  import MessageBubble from "./lib/components/MessageBubble.svelte";
  import type { ChatMsg } from "./lib/components/MessageBubble.svelte";
  import type { ToolEvent } from "./lib/components/ToolTimeline.svelte";
  import Composer from "./lib/components/Composer.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";

  // In dev, Vite proxies /api to the backend; in prod the bundle uses VITE_API_BASE_URL.
  const API = import.meta.env.VITE_API_BASE_URL ?? "";

  let input = $state("");
  let messages = $state<ChatMsg[]>([]);
  let busy = $state(false);
  let sessionId = $state(getSessionId());
  let conversations = $state<ConversationSummary[]>([]);
  let controller: AbortController | undefined;

  let scroller = $state<HTMLDivElement | undefined>(undefined);
  function scrollToEnd() {
    queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  }

  function toTools(toolCalls: unknown): ToolEvent[] {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((t) => ({
      id: (t?.id as string) ?? crypto.randomUUID(),
      name: String(t?.name ?? "tool"),
      status: t?.status === "started" ? "started" : "completed",
    }));
  }

  function restore(sm: StoredMessage): ChatMsg {
    return {
      id: sm.id,
      role: sm.role,
      content: sm.content,
      tools: sm.role === "assistant" ? toTools(sm.toolCalls) : [],
      streaming: false,
    };
  }

  async function refreshConversations() {
    try {
      conversations = await listConversations();
    } catch {
      /* non-fatal — sidebar just stays as-is */
    }
  }

  async function loadMessages(id: string) {
    try {
      const stored = await getConversationMessages(id);
      messages = stored.map(restore);
      scrollToEnd();
    } catch {
      messages = [];
    }
  }

  onMount(async () => {
    await Promise.all([refreshConversations(), loadMessages(sessionId)]);
  });

  function resetTool(tools: ChatMsg["tools"], name: string, id?: string) {
    let matched = false;
    return tools.map((t) => {
      if (matched) return t;
      const hit = id ? t.id === id : t.name === name && t.status === "started";
      if (hit) {
        matched = true;
        return { ...t, status: "completed" as const };
      }
      return t;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    input = "";
    busy = true;

    messages = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: text, tools: [], streaming: false },
      { id: crypto.randomUUID(), role: "assistant", content: "", tools: [], streaming: true },
    ];
    const assistant = messages[messages.length - 1]!;
    scrollToEnd();

    const streamer = new SmoothStreamer((full) => {
      assistant.content = full;
      scrollToEnd();
    });

    const body: ChatRequest = {
      messages: messages
        .slice(0, -1)
        .filter((m) => m.content.trim())
        .map((m) => ({ role: m.role, content: m.content })),
      sessionId,
    };

    controller = new AbortController();
    try {
      const token = await getToken();
      for await (const ev of streamChat(`${API}/api/chat`, body, {
        ...(token ? { token } : {}),
        clientId: getClientId(),
        signal: controller.signal,
      })) {
        switch (ev.type) {
          case "token":
            streamer.push(ev.delta);
            break;
          case "tool":
            if (ev.status === "started") {
              assistant.tools = [
                ...assistant.tools,
                { id: ev.id ?? crypto.randomUUID(), name: ev.name, status: "started" },
              ];
            } else {
              assistant.tools = resetTool(assistant.tools, ev.name, ev.id);
            }
            scrollToEnd();
            break;
          case "tool_progress":
            assistant.tools = assistant.tools.map((t) =>
              t.name === ev.name ? { ...t, message: ev.message } : t,
            );
            break;
          case "status":
            assistant.statusMs = ev.elapsedMs;
            break;
          case "done":
            streamer.done();
            assistant.streaming = false;
            break;
          case "error":
            streamer.done();
            assistant.error = ev.message;
            assistant.streaming = false;
            break;
        }
      }
    } catch (err) {
      streamer.done();
      assistant.streaming = false;
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        assistant.error = err instanceof Error ? err.message : String(err);
      } else if (!assistant.content) {
        assistant.error = "Stopped.";
      }
    } finally {
      assistant.streaming = false;
      busy = false;
      controller = undefined;
      scrollToEnd();
      refreshConversations(); // title/order may have changed
    }
  }

  function stop() {
    controller?.abort();
  }

  function startNew() {
    if (busy) return;
    sessionId = newSession();
    messages = [];
  }

  async function selectConversation(id: string) {
    if (busy || id === sessionId) return;
    const url = new URL(location.href);
    url.searchParams.set("c", id);
    history.replaceState(null, "", url);
    sessionId = id;
    await loadMessages(id);
  }

  async function removeConversation(id: string) {
    await apiDelete(id);
    await refreshConversations();
    if (id === sessionId) startNew();
  }
</script>

<div class="layout">
  <Sidebar
    {conversations}
    activeId={sessionId}
    onSelect={selectConversation}
    onDelete={removeConversation}
    onNew={startNew}
  />

  <div class="main">
    <header><div class="brand">DF Cerebe</div></header>

    <div class="scroll" bind:this={scroller}>
      <div class="thread">
        {#if !messages.length}
          <div class="empty">
            <h1>Internal dashboard agent</h1>
            <p>Ask a question — replies stream in, and the agent recalls relevant
              context from past conversations.</p>
          </div>
        {/if}
        {#each messages as m (m.id)}
          <MessageBubble msg={m} />
        {/each}
      </div>
    </div>

    <div class="composer-wrap">
      <Composer bind:value={input} {busy} onsend={send} onstop={stop} />
    </div>
  </div>
</div>

<style>
  .layout {
    display: flex;
    height: 100%;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 880px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }
  .thread {
    min-height: 100%;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    margin-top: 18vh;
  }
  .empty h1 {
    font-size: 1.3rem;
    color: var(--text);
    margin: 0 0 0.4rem;
  }
  .composer-wrap {
    padding: 0.75rem 1rem 1rem;
  }
</style>
