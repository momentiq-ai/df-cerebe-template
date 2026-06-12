<script lang="ts">
  /**
   * Conversation sidebar (docs/design §7.5) — lists the entity's past
   * conversations, with select + delete. Survives reloads because the transcript
   * is server-stored.
   */
  import type { ConversationSummary } from "@df-cerebe/shared";

  let {
    conversations = [],
    activeId,
    onSelect,
    onDelete,
    onNew,
  }: {
    conversations?: ConversationSummary[];
    activeId?: string;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onNew: () => void;
  } = $props();

  function when(ms: number | null): string {
    if (!ms) return "";
    const d = Math.floor((Date.now() - ms) / 1000);
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}d`;
  }
</script>

<aside class="sidebar">
  <button class="new" onclick={onNew}>+ New chat</button>
  <ul>
    {#each conversations as c (c.id)}
      <li class:active={c.id === activeId}>
        <button class="open" onclick={() => onSelect(c.id)} title={c.title ?? "Untitled"}>
          <span class="title">{c.title ?? "Untitled"}</span>
          <span class="meta">{when(c.lastMessageAt ?? c.updatedAt)}</span>
        </button>
        <button
          class="del"
          title="Delete"
          aria-label="Delete conversation"
          onclick={() => onDelete(c.id)}>×</button
        >
      </li>
    {/each}
    {#if !conversations.length}
      <li class="empty">No conversations yet</li>
    {/if}
  </ul>
</aside>

<style>
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0.6rem;
    overflow-y: auto;
  }
  .new {
    font: inherit;
    font-size: 0.85rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem;
    cursor: pointer;
    margin-bottom: 0.6rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  li {
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  li.active {
    background: var(--surface);
  }
  li:hover {
    background: var(--surface);
  }
  .open {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    font: inherit;
    padding: 0.45rem 0.5rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .title {
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .del {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 0.5rem;
    cursor: pointer;
    opacity: 0;
  }
  li:hover .del {
    opacity: 1;
  }
  .del:hover {
    color: var(--err);
  }
  .empty {
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0.5rem;
  }
</style>
