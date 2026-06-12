/**
 * Clerk auth — graceful-optional, official @clerk/clerk-js (no framework wrapper).
 *
 * If VITE_CLERK_PUBLISHABLE_KEY is set, the app gates behind Clerk sign-in and
 * sends the session token to the backend. If it's absent, auth is OFF and the
 * app runs open (dev/prototype). The backend mirrors this (see requireAuth).
 */
import type { Clerk } from "@clerk/clerk-js";

const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** True when a Clerk publishable key is configured. */
export const authEnabled = Boolean(pk);

let clerk: Clerk | undefined;

/**
 * Load Clerk if configured. Returns the client, or undefined in open mode.
 *
 * `@clerk/clerk-js` is **dynamically imported** so it's a lazy chunk that's only
 * fetched when a publishable key is set — in open mode (the template default) it
 * never enters the bundle. This keeps the lean default genuinely lean.
 */
export async function loadAuth(): Promise<Clerk | undefined> {
  if (!pk) return undefined;
  const { Clerk } = await import("@clerk/clerk-js");
  clerk = new Clerk(pk);
  await clerk.load();
  return clerk;
}

/** Current session JWT to send to the backend, or undefined in open mode. */
export async function getToken(): Promise<string | undefined> {
  if (!clerk?.session) return undefined;
  return (await clerk.session.getToken()) ?? undefined;
}
