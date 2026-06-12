/**
 * Frontend entrypoint. Gates the app behind Clerk sign-in when auth is enabled
 * (VITE_CLERK_PUBLISHABLE_KEY set); otherwise mounts the app directly (open mode).
 */
import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { loadAuth } from "./lib/auth";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount point missing in index.html");

const clerk = await loadAuth();

if (clerk && !clerk.user) {
  // Auth on, not signed in → show Clerk's sign-in UI in a dedicated div
  // (mountSignIn requires an HTMLDivElement), then mount the app once signed in.
  const signInDiv = document.createElement("div");
  target.appendChild(signInDiv);
  clerk.mountSignIn(signInDiv);
  clerk.addListener(({ user }) => {
    if (user) {
      target.replaceChildren();
      mount(App, { target });
    }
  });
} else {
  // Open mode (no Clerk key) or already signed in.
  mount(App, { target });
}
