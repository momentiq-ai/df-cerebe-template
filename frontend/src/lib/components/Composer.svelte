<script lang="ts">
  /**
   * Message composer (docs/design §6.5): auto-grow textarea, Enter-to-send /
   * Shift+Enter newline, a char counter, and an animated send⇄stop toggle wired
   * to the parent's AbortController.
   */
  let {
    value = $bindable(""),
    busy = false,
    onsend,
    onstop,
  }: {
    value?: string;
    busy?: boolean;
    onsend: () => void;
    onstop: () => void;
  } = $props();

  let ta = $state<HTMLTextAreaElement | undefined>(undefined);

  // Auto-grow: reset then snap to scrollHeight whenever the text changes.
  $effect(() => {
    value; // dep
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && value.trim()) onsend();
    }
  }
</script>

<form
  class="composer"
  onsubmit={(e) => {
    e.preventDefault();
    if (!busy && value.trim()) onsend();
  }}
>
  <textarea
    bind:this={ta}
    bind:value
    rows="1"
    placeholder="Ask the dashboard agent…  (Enter to send, Shift+Enter for newline)"
    onkeydown={onKeydown}
  ></textarea>
  <div class="bar">
    <span class="count">{value.length}</span>
    {#if busy}
      <button type="button" class="stop" onclick={onstop}>■ Stop</button>
    {:else}
      <button type="submit" class="send" disabled={!value.trim()}>Send ➤</button>
    {/if}
  </div>
</form>

<style>
  .composer {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    padding: 0.5rem 0.6rem;
  }
  textarea {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    resize: none;
    outline: none;
    line-height: 1.5;
    max-height: 200px;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.25rem;
  }
  .count {
    color: var(--muted);
    font-size: 0.75rem;
    margin-right: auto;
  }
  button {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.8rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition:
      transform 0.08s,
      background 0.15s,
      opacity 0.15s;
  }
  button:active {
    transform: scale(0.96);
  }
  .send {
    background: var(--accent);
    color: #fff;
  }
  .send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .stop {
    background: var(--err);
    color: #fff;
  }
</style>
