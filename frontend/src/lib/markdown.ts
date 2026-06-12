/**
 * Markdown rendering for chat messages (docs/design §6.3, DECIDED).
 *
 *   marked (GFM) → DOMPurify sanitize → returned as a string for Svelte `{@html}`.
 *
 * Syntax highlighting is a POST-render pass: <MarkdownMessage> runs
 * `hljs.highlightElement` on the inserted `<pre><code>` blocks (keeps this module
 * free of a marked-highlight dependency and re-highlights blocks as they stream).
 *
 * ⚠ Sanitization is LOAD-BEARING with `{@html}` — never render unsanitized markup.
 * We skip math (KaTeX) and Mermaid by design. Incomplete markup mid-stream is left
 * to self-correct when the closing token arrives.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";
// The "common" bundle registers ~37 widely-used languages instead of all ~190 —
// a big bundle win that still covers anything pasted into a chat. Swap to
// "highlight.js/lib/core" + explicit registerLanguage() to trim further.
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  // Default marked is synchronous (no async extensions registered).
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/**
 * Highlight any not-yet-highlighted code blocks under `root`. Post-render pass so
 * we avoid a marked-highlight dependency and re-highlight blocks as they stream.
 * Single shared hljs instance (the common bundle above).
 */
export function highlightCodeBlocks(root: HTMLElement): void {
  for (const node of root.querySelectorAll<HTMLElement>("pre code:not(.hljs)")) {
    hljs.highlightElement(node);
  }
}
