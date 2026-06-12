# `.agent-review/` — Dark Factory gate configuration

This directory configures the **local** Dark Factory critic quorum that runs on
every commit. It is the consumer-side contract documented in
[`momentiq-ai/dark-factory` › CONSUMER-ADOPTION.md](https://github.com/momentiq-ai/dark-factory/blob/main/docs/CONSUMER-ADOPTION.md).

## `config.json` — annotated

Comments aren't allowed in JSON (the file is validated against
`@momentiq/dark-factory-schemas`), so the explanation lives here.

| Field | What it does |
|---|---|
| `version: 2` | Config schema version. Pinned by the schemas package. |
| `critics[]` | The available critics. We ship two: **Cursor** and **Codex**. Each is `required: false` so a missing/unauthenticated vendor degrades gracefully instead of hard-failing. |
| `critics[].adapter` | Which vendor SDK the CLI shells out to (`cursor-sdk`, `codex-sdk`). |
| `critics[].model` | Model + params the critic runs at. **NOTE(verify):** model ids (`composer-2.5`, `gpt-5.5`) drift as vendors ship — confirm with the vendor CLI after install. |
| `profiles.local` | The profile `.husky/post-commit` pins via `AGENT_REVIEW_PROFILE=local`. |
| `profiles.local.quorum: 1` | One critic verdict is enough locally. **Bump to `2`** once you have BOTH Cursor and Codex subscriptions authenticated, for stronger local signal. |
| `profiles.local.auth` | Maps each critic to its auth mode. `chatgpt` = use the Codex subscription login (flat-rate), not a per-token API key. |
| `aggregation.blockingSeverities` | Which finding severities block a push (`blocker`, `high`). `medium`/`low` are advisory. |
| `git.artifactDir` / `artifactScope` | Per-SHA review artifacts land in `.git/agent-reviews/<sha>.md` (+ `.json`). `git-common-dir` keeps them correct across worktrees. |

## What you must do before the gate actually runs

1. `bun install` (brings in `@momentiq/dark-factory-cli@2.5.0` → `./node_modules/.bin/df`).
2. Authenticate **at least one** critic's subscription locally:
   - Cursor: sign in via the Cursor agent CLI.
   - Codex: `codex login` (ChatGPT subscription).
   - With zero subscriptions, the local critic reports "0 critics ran" and the
     pre-push gate **fails closed** (by design). For a trivial commit you can
     `AGENT_REVIEW_SKIP=1 git commit` (audited in `.git/agent-reviews/_runs.ndjson`).
3. The Husky hooks (`.husky/post-commit`, `.husky/pre-push`) are already in place.

## Optional, not yet wired

- **`prompts/local-critic.md`** — a custom critic prompt override. The CLI ships a
  baseline prompt, so this is optional. Left as a placeholder; see that file.
- **CI / hosted W3 critic** — the cloud gate that posts a Check Run on PRs. Requires
  installing the Dark Factory GitHub App + a reusable workflow. **Out of scope for
  this first draft** — tracked in `docs/notes.md`. The local gate works standalone.
- **Docker-build evidence shim** (`scripts/check-dockerfile.sh`) — see that file.
  Optional; only matters once you push commits that touch a Dockerfile.
