/**
 * Session + client identity (docs/design §6.7, §8.2).
 *
 * - `sessionId` — the conversation id; doubles as the Cerebe session + LangGraph
 *   thread. Kept in the URL (`?c=`) so a reload/share resumes the same thread.
 * - `clientId` — a stable per-browser id in localStorage, used to derive the
 *   open-mode `entityId` (`anon:<clientId>`) when Clerk auth is off. When auth is
 *   on the server ignores it and derives `user:<sub>` from the verified token.
 *
 * Both are sent on every chat request; the server tolerates their absence.
 */

const CLIENT_KEY = "df-cerebe.clientId";

function uuid(): string {
  return crypto.randomUUID();
}

/** Stable per-browser id; created + persisted on first use. */
export function getClientId(): string {
  let v = localStorage.getItem(CLIENT_KEY);
  if (!v) {
    v = uuid();
    localStorage.setItem(CLIENT_KEY, v);
  }
  return v;
}

/** Current conversation id from `?c=`; minted + written to the URL if absent. */
export function getSessionId(): string {
  const url = new URL(location.href);
  let c = url.searchParams.get("c");
  if (!c) {
    c = uuid();
    url.searchParams.set("c", c);
    history.replaceState(null, "", url);
  }
  return c;
}

/** Start a fresh conversation: new id in the URL, returned for the caller to use. */
export function newSession(): string {
  const url = new URL(location.href);
  const c = uuid();
  url.searchParams.set("c", c);
  history.replaceState(null, "", url);
  return c;
}
