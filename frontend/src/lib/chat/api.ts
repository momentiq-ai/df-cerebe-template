/**
 * Conversation REST client (docs/design §7.5). Pairs with the streaming chat in
 * stream.ts. Every request carries the Clerk token (when present) + the
 * X-Client-Id header so the server scopes to the right entity.
 */
import { CLIENT_ID_HEADER } from "@df-cerebe/shared";
import type { ConversationSummary, StoredMessage } from "@df-cerebe/shared";
import { getToken } from "../auth";
import { getClientId } from "../session";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

async function authHeaders(extra: Record<string, string> = {}): Promise<HeadersInit> {
  const token = await getToken();
  return {
    [CLIENT_ID_HEADER]: getClientId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(`${API}/api/conversations`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getConversationMessages(id: string): Promise<StoredMessage[]> {
  const res = await fetch(`${API}/api/conversations/${id}/messages`, {
    headers: await authHeaders(),
  });
  if (res.status === 404) return []; // not created yet (no turns) — empty thread
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API}/api/conversations/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await fetch(`${API}/api/conversations/${id}`, {
    method: "PATCH",
    headers: await authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
