/**
 * SSE stream helpers for the chat route.
 *
 * `withHeartbeat` merges an agent event stream with a silence heartbeat: it yields
 * every source event and injects a `status` frame whenever `intervalMs` passes
 * with no event — keeping the SSE connection alive during long tool calls
 * (docs/design §4.5/§5). It's a single consumer, so there are never concurrent
 * SSE writes; the heartbeat just interleaves into the same generator.
 */

import type { AgentStreamEvent, ChatStreamEvent } from "@df-cerebe/shared";

/** Default heartbeat cadence; overridable via env (handy for ops + tests). */
export const HEARTBEAT_MS = Number(process.env.CHAT_HEARTBEAT_MS ?? 15_000);

const TICK = Symbol("tick");

export async function* withHeartbeat(
  source: AsyncGenerator<AgentStreamEvent>,
  startTs: number,
  intervalMs: number = HEARTBEAT_MS,
): AsyncGenerator<ChatStreamEvent> {
  const it = source[Symbol.asyncIterator]();
  let nextEvent = it.next();
  for (;;) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<typeof TICK>((resolve) => {
      timeoutId = setTimeout(() => resolve(TICK), intervalMs);
    });
    const winner = await Promise.race([nextEvent, timer]);
    if (timeoutId) clearTimeout(timeoutId);
    if (winner === TICK) {
      yield { type: "status", elapsedMs: Date.now() - startTs };
      continue; // nextEvent is still pending — keep awaiting it
    }
    if (winner.done) return;
    yield winner.value;
    nextEvent = it.next();
  }
}
