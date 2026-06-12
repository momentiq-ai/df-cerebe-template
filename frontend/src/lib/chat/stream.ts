/**
 * SSE stream client for POST /api/chat.
 *
 * EventSource is GET-only, so we POST and parse the `text/event-stream` body by
 * hand. Yields each typed ChatStreamEvent (docs/design §5/§6.1) — token, tool,
 * tool_progress, status, done, error. Pass an AbortSignal to support stop.
 */

import { CLIENT_ID_HEADER } from "@df-cerebe/shared";
import type { ChatRequest, ChatStreamEvent } from "@df-cerebe/shared";

export async function* streamChat(
  url: string,
  body: ChatRequest,
  opts: { token?: string; clientId?: string; signal?: AbortSignal } = {},
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.clientId ? { [CLIENT_ID_HEADER]: opts.clientId } : {}),
    },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; keep the trailing partial.
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        yield JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
