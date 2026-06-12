<script lang="ts">
  /**
   * One chat message (docs/design §6.6). Role alignment, a copy button, and a
   * streaming-vs-settled render. User text is rendered plain (escaped); assistant
   * text goes through <MarkdownMessage> with its tool timeline above it.
   */
  import { fade } from "svelte/transition";
  import MarkdownMessage from "./MarkdownMessage.svelte";
  import ToolTimeline from "./ToolTimeline.svelte";
  import type { ToolEvent } from "./ToolTimeline.svelte";

  export type ChatMsg = {
    id: string;
    role: "user" | "assistant";
    content: string;
    tools: ToolEvent[];
    streaming: boolean;
    error?: string;
    statusMs?: number;
  };

  let { msg }: { msg: ChatMsg } = $props();

  let copied = $state(false);
  async function copy() {
    await navigator.clipboard.writeText(msg.content);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  const showThinking = $derived(
    msg.role === "assistant" && msg.streaming && !msg.content && !msg.tools.length,
  );
</script>

<div class="row {msg.role}" in:fade={{ duration: 120 }}>
  <div class="bubble">
    {#if msg.role === "assistant"}
      <ToolTimeline tools={msg.tools} />
      {#if showThinking}
        <div class="thinking">
          Thinking{#if msg.statusMs}… {(msg.statusMs / 1000).toFixed(0)}s{/if}
        </div>
      {:else}
        <MarkdownMessage content={msg.content} streaming={msg.streaming} />
      {/if}
      {#if msg.error}<div class="error">⚠ {msg.error}</div>{/if}
      {#if msg.content && !msg.streaming}
        <button class="copy" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
      {/if}
    {:else}
      <div class="user-text">{msg.content}</div>
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    margin: 0.5rem 0;
  }
  .row.user {
    justify-content: flex-end;
  }
  .bubble {
    position: relative;
    max-width: min(80ch, 88%);
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.55;
  }
  .row.user .bubble {
    background: var(--accent);
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .row.assistant .bubble {
    background: var(--surface);
    border: 1px solid var(--border);
    border-bottom-left-radius: 4px;
  }
  .user-text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .thinking {
    color: var(--muted);
    font-style: italic;
  }
  .error {
    color: var(--err);
    margin-top: 0.4em;
    font-size: 0.85rem;
  }
  .copy {
    position: absolute;
    top: 0.35rem;
    right: 0.4rem;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    border-radius: 5px;
    opacity: 0;
    transition: opacity 0.15s;
    cursor: pointer;
  }
  .bubble:hover .copy {
    opacity: 1;
  }
</style>
