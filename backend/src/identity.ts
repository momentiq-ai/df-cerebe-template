/**
 * Request identity (docs/design §8.2). Shared by the chat + conversation routes.
 *
 * `entityId` is ALWAYS server-derived: `user:<clerkSub>` when a token is verified
 * (set on the context by requireAuth), else `anon:<clientId>` from the
 * `X-Client-Id` header. A client value can never become a `user:` id.
 */
import type { Context } from "hono";
import { CLIENT_ID_HEADER } from "@df-cerebe/shared";

/** Per-request context vars. `entityId` is set by requireAuth when auth is on. */
export type Env = { Variables: { entityId?: string } };

export function resolveEntityId(c: Context<Env>): string {
  return c.get("entityId") ?? `anon:${c.req.header(CLIENT_ID_HEADER) ?? "local"}`;
}
