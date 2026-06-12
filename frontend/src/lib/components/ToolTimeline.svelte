<script lang="ts">
  /**
   * Vertical tool/step timeline (docs/design §6.4) — the visible proof the agent
   * used memory/tools. Driven by the `tool` / `tool_progress` events: started →
   * spinner, completed → check, with a humanized label.
   */
  export type ToolEvent = {
    id: string;
    name: string;
    status: "started" | "completed";
    message?: string;
  };

  let { tools = [] }: { tools?: ToolEvent[] } = $props();

  /** snake_case / kebab → Title Case for display. */
  function humanize(name: string): string {
    return name
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
</script>

{#if tools.length}
  <ul class="timeline">
    {#each tools as t (t.id)}
      <li class:done={t.status === "completed"}>
        <span class="icon" aria-hidden="true">
          {#if t.status === "completed"}✓{:else}<span class="spinner"></span>{/if}
        </span>
        <span class="label">
          {humanize(t.name)}
          {#if t.message}<span class="msg">— {t.message}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .timeline {
    list-style: none;
    margin: 0 0 0.5em;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-size: 0.82rem;
    color: var(--muted);
  }
  li.done {
    color: var(--ok);
  }
  .icon {
    width: 1.1em;
    display: inline-flex;
    justify-content: center;
  }
  .msg {
    color: var(--muted);
  }
  .spinner {
    width: 0.8em;
    height: 0.8em;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
