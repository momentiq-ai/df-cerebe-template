<script lang="ts">
  /**
   * Renders assistant markdown: sanitized HTML via {@html}, with highlight.js run
   * as a post-render pass on the inserted code blocks (re-highlights new blocks as
   * the message streams). Swappable single component (docs/design §6.3).
   */
  import { renderMarkdown, highlightCodeBlocks } from "../markdown";

  let { content = "", streaming = false }: { content?: string; streaming?: boolean } =
    $props();

  let el = $state<HTMLDivElement | undefined>(undefined);
  const html = $derived(content ? renderMarkdown(content) : "");

  // After each {@html} update, highlight any not-yet-highlighted code blocks.
  $effect(() => {
    html; // re-run when the rendered HTML changes
    if (el) highlightCodeBlocks(el);
  });
</script>

{#if content}
  <div class="md" bind:this={el}>{@html html}</div>
{:else if streaming}
  <div class="md thinking">Thinking…</div>
{/if}

<style>
  .md :global(p) {
    margin: 0 0 0.6em;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(pre) {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75em 0.9em;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
  }
  .md :global(:not(pre) > code) {
    background: var(--code-bg);
    padding: 0.15em 0.35em;
    border-radius: 4px;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.3em 0;
    padding-left: 1.4em;
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: 0.3em 0.6em;
  }
  .md :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: 0.5em 0;
    padding-left: 0.8em;
    color: var(--muted);
  }
  .thinking {
    color: var(--muted);
    font-style: italic;
  }
</style>
