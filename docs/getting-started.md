# Get started — run DF Cerebe locally in minutes, deploy when you choose

> **Native dev first. Infrastructure last, and only if you want it.**
> TypeScript on both ends, one agent runtime, gated by Dark Factory from the
> first commit. No Kubernetes, no Docker, no cluster to bring up before you see
> your dashboard on screen.

This walkthrough takes you from a fresh clone to a running, gated internal
dashboard. The core loop is **a couple of minutes** — most of it is `bun install`.
Deployment (Docker + k8s) is a separate, optional path at the end.

> **Template status:** the backend (Hono + LangGraph.js agent), the streaming
> chat frontend, the shared types, and the Dark Factory gate are **implemented
> and verified** — `bun install`, the dev loop, type-checks, the frontend build,
> and the agent's call to Cerebe were all exercised end to end. Auth (Clerk) is
> also **wired and verified** — graceful-optional, off until you add Clerk keys.
> What's left for you: add your Cerebe key (Step 3); add Clerk keys if/when you
> want auth (Step 4). Dependencies are **declared (pinned) but not installed** in
> the template itself — your `bun install` brings them in. Open decisions are
> collected in [`notes.md`](notes.md).

## What you'll build

By the end you have:

- A **TypeScript dashboard** — Hono + LangGraph.js backend, Vite + Svelte
  frontend, sharing types through one `shared/` package
- It **running natively** at `http://localhost:5173` — no containers involved
- A **first agent turn** streamed from the backend to the chat surface
- **Auth via Clerk** and **secrets via Doppler** (both optional to start)
- A **first commit reviewed** by the Dark Factory local critic quorum, with an
  evidence-bound artifact at `.git/agent-reviews/<sha>.md`
- A **fully-working but isolated deploy path** (Docker + Kubernetes) you can
  reach for later — and never have to think about until then

## Drive this with an AI agent (optional)

Paste this into Claude Code, Cursor, or any agentic surface and it will run the
walkthrough interactively — showing each command, confirming before anything
destructive, and surfacing URLs:

```
You are helping me stand up DF Cerebe, an internal dashboard built on:
  Backend  — Bun + Hono + LangGraph.js (TypeScript agent runtime)
  Frontend — Vite + Svelte SPA (TypeScript), Clerk auth
  Shared   — a TypeScript types package imported by both sides
  Gate     — Dark Factory local critic quorum (@momentiq/dark-factory-cli)
  Deploy   — Docker + Kubernetes, isolated in deploy/, OPTIONAL

Native local dev must never require Docker or Kubernetes. Walk me through the
steps in docs/getting-started.md interactively: show the command, ask before
anything destructive, run it, verify the expected outcome, then continue. If
something fails, diagnose and propose a fix.

1. Verify prereqs: bun (>=1.1), git. On Windows, confirm I'm running in WSL2 with
   the repo on the Linux filesystem (~/..., not /mnt/c). docker + kubectl are
   deploy-path only. Give the install one-liner for anything missing on my OS.
2. Authenticate at least one Dark Factory critic subscription (Cursor and/or
   Codex — e.g. `codex login`). Without it the pre-push gate (step 7) fails
   closed, so do this early.
3. (Optional) Rename the template to my product: run
   `bun run init -- --dry-run --name "<my product>"` to preview, then apply it.
4. bun install. Confirm the Dark Factory CLI landed at ./node_modules/.bin/df and
   that the hooks armed (`git config core.hooksPath` returns .husky).
5. Copy .env.example to .env. Help me get a Cerebe API key and Clerk keys.
6. bun run dev. Surface http://localhost:5173 and confirm the backend health
   check at http://localhost:8787/health.
7. Make a trivial change, commit it, and confirm the Dark Factory post-commit
   critic produced .git/agent-reviews/<sha>.md with a verdict.

Start at step 1. Ask before each shell command.
```

## …or follow the steps manually

## Requirements before you start

**Must have — dev won't run without these:**

- **[Bun](https://bun.sh) ≥ 1.1** — the runtime, package manager, and script
  runner for the whole repo. (`curl -fsSL https://bun.sh/install | bash`)
- **Git ≥ 2.40** — source control + the Dark Factory commit/push hooks.
- **macOS or Linux.** Native dev assumes a Unix shell. **On Windows, use
  [WSL2](https://learn.microsoft.com/windows/wsl/install):** install Bun *inside*
  the WSL2 distro and keep the repo on the Linux filesystem (`~/...`, not
  `/mnt/c/...`) — otherwise hot-reload and the git hooks are slow and flaky.

**Needed before your first commit is gated (Step 6) — set up now to avoid a wall:**

- **At least one Cursor and/or Codex subscription, authenticated locally.** The
  Dark Factory local critic uses these flat-rate logins instead of API keys. With
  **zero** critics authenticated the pre-push gate **fails closed**, so sign in to
  at least one (`cursor-agent` sign-in / `codex login`) before you push.

**Needed only when you reach that step — not upfront:**

- A **Cerebe API key** (the agent's engine, Step 3) — <https://cerebe.ai>.
  *(Prefer raw Anthropic? See [`notes.md`](notes.md) §4.)*
- A **Clerk** account for auth (Step 4) — <https://clerk.com>. Optional while prototyping.
- A **Doppler** account for production secrets (Step 5) — <https://doppler.com>.
  Optional; a local `.env` works until you deploy.
- **Docker + kubectl** — **deploy path only**, never for dev. See
  [`deploy/README.md`](../deploy/README.md).

> **Node.js never runs your app** here — Bun does. You don't even need Node
> installed for dev. (The Dark Factory CLI is a self-contained bundle Bun runs
> fine.) See [`notes.md`](notes.md) "Node vs Bun".

## Step 0 — Name your product (~30 sec, one time)

If you created this repo from the template and want it called something other
than "df-cerebe", run the init script — the lightweight replacement for Copier
(pure text substitution, no Python):

```bash
bun run init -- --dry-run --name "Your Product"   # preview the changes first
bun run init -- --name "Your Product"             # apply (derives a slug)
```

It replaces the `df-cerebe` slug (npm scope, k8s names, hostnames) and the `DF Cerebe`
display name throughout the tree, and removes the template's own build journals
(`WORK_LOG_*.txt`). No files are renamed — the name only ever appears in file
contents. Pass `--slug my-slug` to override the derived slug, or `--fresh-git` to
detach from the template's git history. Skip this step entirely to keep `df-cerebe`.

## Step 1 — Install (~1 min)

```bash
bun install
```

This installs every workspace (`backend`, `frontend`, `shared`) **and** the Dark
Factory gate CLI (`@momentiq/dark-factory-cli@2.5.0`) pinned in the root
`package.json`. Confirm the gate binary landed:

```bash
./node_modules/.bin/df --help
```

> **This install is what turns the gate on.** The hooks in `.husky/` are
> **dormant until now** — git only runs them once the `prepare` script (which
> runs automatically during `bun install`) installs Husky and points
> `core.hooksPath` at `.husky/`. So the Dark Factory critic starts reviewing from
> your **next commit after this install**, not before. (If you ever find commits
> aren't being reviewed, run `bun run prepare` to re-arm the hooks — see
> [`notes.md`](notes.md) §14.) If you bootstrapped via the tarball and have no
> `.git` yet, run `git init -b main` **before** `bun install` so Husky has a repo
> to arm.

> **Commit the lockfile.** Bun writes `bun.lock` (or `bun.lockb`) — commit it.
> The Dark Factory contract requires a committed lockfile so any CI install
> resolves the exact same CLI version (see [`notes.md`](notes.md)).

## Step 2 — Run the dev loop (~seconds)

```bash
cp .env.example .env       # we'll fill it in next step; dev starts without keys
bun run dev
```

This starts **both** services natively, each with hot reload:

- Backend (Hono + LangGraph.js) on `http://localhost:8787`
- Frontend (Vite + Svelte) on `http://localhost:5173`

Open <http://localhost:5173> — you'll see the dashboard chat surface. Sanity
check the backend:

```bash
curl http://localhost:8787/health        # → {"ok":true,"service":"df-cerebe-backend"}
```

No Docker. No cluster. This is the whole inner loop.

| Command | What it does |
|---|---|
| `bun run dev` | Start both backend and frontend (hot-reload) |
| `bun run dev:backend` | Start only the backend on `:8787` |
| `bun run dev:frontend` | Start only the frontend on `:5173` |
| `Ctrl+C` | Stop all running servers |

Both servers hot-reload on file changes — no restart needed after editing code or
`.env`. `Ctrl+C` stops everything cleanly.

## Step 3 — Add your key + first agent turn

The agent runtime is **already implemented** — a LangGraph.js `StateGraph` in
`backend/src/agent/graph.ts` calling Cerebe, streamed to the chat UI over SSE.
All it needs is a key.

1. Put your Cerebe key in `.env`:
   ```bash
   CEREBE_API_KEY=ck_live_...
   LLM_MODEL=gpt-4o      # default; see notes.md "Model selection"
   ```
2. The dev server hot-reloads, so just **send a message from the dashboard chat
   box** at <http://localhost:5173>. You'll see the reply stream in token by
   token. (Without a key you'll get a clear `authentication_error` in the chat —
   that's the wiring working; add the key.)

> **Why LangGraph.js (not Python):** one language across the repo and shared
> types with the frontend. The JS port trails Python LangGraph on the newest
> features — fine for a dashboard agent. Full trade-off in [`notes.md`](notes.md).
> Want to extend the agent? `graph.ts` is a minimal single-node graph — add tool
> nodes + conditional edges there.

## Step 4 — Auth with Clerk *(optional — already wired, graceful-optional)*

Clerk auth is **implemented** with the official packages (`@clerk/backend` on the
server, `@clerk/clerk-js` on the frontend — Svelte is just JS, so no framework
wrapper is needed). It's **graceful-optional**: it turns on only when you provide
keys.

- **No keys → open mode.** The app runs with `/api/*` unauthenticated and the
  backend logs a loud warning. Perfect for prototyping; do not deploy like this.
- **Keys set → enforced.** The frontend gates behind Clerk sign-in and sends the
  session token; the backend verifies it with `verifyToken` and 401s otherwise.

To turn it on: create a Clerk app and put both keys in `.env`, then restart dev:

```bash
CLERK_SECRET_KEY=sk_test_...           # backend verifies tokens
VITE_CLERK_PUBLISHABLE_KEY=pk_test_... # frontend sign-in UI
```

That's it — no code to write. The wiring lives in `backend/src/index.ts`
(`requireAuth`) and `frontend/src/lib/auth.ts` + `main.ts`. Each deployment brings
its **own** Clerk keys (via `.env` / Doppler, never committed).

## Step 5 — Secrets via Doppler *(optional)*

For local dev a `.env` file is enough. When you want managed secrets (teams,
prod), Doppler injects them at runtime — no `.env` shipped:

```bash
doppler login
doppler setup --project df-cerebe          # bind this dir to a Doppler project
doppler secrets set CEREBE_API_KEY=ck_live_... CLERK_SECRET_KEY=sk_test_...
doppler run -- bun run dev              # run with secrets injected
```

In production the same secrets reach Kubernetes via a `Secret` or the Doppler
operator — see [`deploy/README.md`](../deploy/README.md).

## Step 6 — First commit hits the Dark Factory gate (~1–2 min)

This is the part that's fully wired already. The repo has `.agent-review/config.json`
(local critic quorum) and the `.husky/` hooks installed.

### Authenticate at least one critic

The local critics use your **subscription** logins (flat-rate), not API keys:

- Cursor — sign in via the Cursor agent CLI
- Codex — `codex login` (ChatGPT subscription)

With zero subscriptions the critic reports "0 critics ran" and the pre-push gate
fails closed (by design). See [`.agent-review/README.md`](../.agent-review/README.md).

### Make a change and commit

```bash
# edit README.md or anything
git add -A
git commit -m "chore: first commit"
```

The `post-commit` hook fires `df review` in the **background** (non-blocking).
After ~30–90s the verdict artifact lands:

```bash
cat .git/agent-reviews/$(git rev-parse HEAD).md
# or
./node_modules/.bin/df findings --range HEAD~1..HEAD
```

A verdict is `APPROVED`, `CHANGES_REQUESTED`, or `BLOCKED`. On
`CHANGES_REQUESTED`, fix the findings in a **new commit** (never amend — the
artifact is bound to the original SHA).

### Push

```bash
git push
```

The `pre-push` hook runs `df gate-push` against your local artifact; if the HEAD
commit is APPROVED, the push proceeds. Genuine emergencies only:
`AGENT_REVIEW_BYPASS="reason" git push` (audited in `_runs.ndjson`).

> **Opt-in next layer:** a hosted critic that posts a **Check Run on your pull
> requests** (the local gate only protects your own machine). It's not wired by
> default because it needs a GitHub App or a CI workflow + secrets + a branch
> ruleset. When you're ready (typically before multi-author merges), see the
> **[Appendix — Enabling the hosted gate](#appendix--enabling-the-hosted-gate-opt-in)**.

## Step 7 — Deploy (later, fully optional)

When — and only when — you want to ship, the entire container + Kubernetes path
lives in [`deploy/`](../deploy/README.md) with its own guide. Nothing in that
folder is required for, or touched by, the dev loop above. Build images with
`bun run docker:build:*`, apply with `bun run k8s:apply`.

## What you have now

- A **native TypeScript dev loop** — `bun install` → `bun run dev` → dashboard
  on screen, hot-reloading, zero infrastructure
- **One language end to end**, with backend ↔ frontend types shared in `shared/`
- A **first commit gated** by the Dark Factory local critic quorum, evidence on
  disk at `.git/agent-reviews/`
- A **deployment path that exists and works** but stays out of your way until you
  choose it

## Where to go next

- [`notes.md`](notes.md) — every open decision and `NOTE(verify)` in one place:
  dependency version pins, LangGraph.js API verification, model selection, Clerk
  -on-Svelte choice, Bun compatibility, Helm-vs-kustomize, the hosted CI gate.
- [`deploy/README.md`](../deploy/README.md) — the optional deploy graduation path.
- [`.agent-review/README.md`](../.agent-review/README.md) — the Dark Factory gate
  config, annotated, and how to strengthen the quorum.
- Upstream Dark Factory consumer guide:
  [`momentiq-ai/dark-factory` › CONSUMER-ADOPTION.md](https://github.com/momentiq-ai/dark-factory/blob/main/docs/CONSUMER-ADOPTION.md).

## Appendix — Enabling the hosted gate (opt-in)

The local gate (Step 6) only protects *your* machine — it does nothing for merges
done through the GitHub UI, the merge queue, auto-merge, or a PR opened from
another machine. To gate **pull requests**, add a hosted critic that posts a
Check Run, then require that check in a branch ruleset. Pick **one** of two paths
(running both is a redundant gate):

### Path A — W3 hosted App (least setup)

The managed Momentiq critic. Install the **Dark Factory GitHub App** on your repo;
it posts a **`dark-factory/critic`** Check Run on each PR. No workflow file, no
API-key secrets to manage. Onboarding + availability: see
[`CONSUMER-ADOPTION.md` §2](https://github.com/momentiq-ai/dark-factory/blob/main/docs/CONSUMER-ADOPTION.md). Then jump to **Make it binding** below and require the
`dark-factory/critic` context.

### Path B — self-hosted CI workflow (you control it, BYO keys)

Run the critic in your own Actions via the reusable workflow. This is the right
path if you don't have access to the hosted App.

1. **Add `.github/workflows/dark-factory-pr.yml`** calling the `agent-critic`
   reusable workflow. Pin it to an **exact commit SHA or `@vX.Y.Z` tag** (never a
   floating `@v0`):

   ```yaml
   name: Dark Factory PR Gate
   on:
     pull_request:
       branches: [main]
       types: [opened, synchronize, reopened, ready_for_review]
     merge_group:

   jobs:
     agent-critic:                       # job id MUST be 'agent-critic' (see note)
       uses: <your-fork>/dark-factory/.github/workflows/agent-critic.yml@<exact-commit-sha>
       with:
         cli-version: '2.5.0'            # match the pin in package.json
         darkfactory_config_path: '.agent-review/config.json'
       secrets:
         CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
         CODEX_API_KEY:  ${{ secrets.CODEX_API_KEY }}
         GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
         XAI_API_KEY:    ${{ secrets.XAI_API_KEY }}
   ```

   > **Two template-specific notes.** (a) Reference **your own fork**
   > (`<your-fork>/dark-factory`, shown above) rather than `momentiq-ai/dark-factory`
   > unless you have org access — calling another org's reusable workflow requires
   > its Actions access to be set to `organization`, which you may not control.
   > (b) **Do not** add the `cycle-doc-validation` job from the upstream example —
   > that enforces Momentiq's `docs/roadmap/cycles/` convention, which this
   > template doesn't use. `agent-critic` alone is the gate.

2. **Why API keys here?** CI runners can't use your Cursor/Codex *subscriptions*
   (those are local-only), so CI critics fall back to per-token API keys. Set the
   ones for the critics you run (others degrade gracefully via min-complete-quorum):

   ```bash
   gh secret set CURSOR_API_KEY --repo <your-org>/<your-repo>
   gh secret set CODEX_API_KEY  --repo <your-org>/<your-repo>
   ```

### Make it binding (both paths)

Installing/running a critic posts a verdict but **does not block merges** — a
ruleset does. Create one requiring the check to be green and bot review threads
resolved:

```bash
gh api -X POST repos/<your-org>/<your-repo>/rulesets --input main-enforcement.json
```

In `main-enforcement.json`, require the **exact** status-check context string:

- **Path A:** `dark-factory/critic`
- **Path B:** `agent-critic / agent-critic` — the `<job-id> / <callee-job-name>`
  form, **not** the bare `agent-critic`. Requiring the bare name never matches and
  blocks every PR forever (this is the #1 wiring mistake).

The full ruleset JSON + the exact required-context rules are in
[`CONSUMER-ADOPTION.md` §10](https://github.com/momentiq-ai/dark-factory/blob/main/docs/CONSUMER-ADOPTION.md). Both gates consume the **same** `@momentiq/dark-factory-cli`
and `.agent-review/config.json`, so local and hosted verdicts agree on a diff.
