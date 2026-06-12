# CLAUDE.md

Context for Claude Code in this repo lives in [`AGENTS.md`](AGENTS.md) — a single
vendor-neutral source so every agent (Claude, Cursor, Codex) reads the same
rules. Start there.

Quick reminders (the three that matter most):

1. **Native dev never requires Docker/Kubernetes** — `bun install` → `bun run dev`.
   All container/k8s lives in `deploy/` and is opt-in.
2. **Shared types in `shared/`** — don't duplicate API shapes across backend/frontend.
3. **Don't weaken the Dark Factory gate** (`.husky/`, `.agent-review/`). Fix
   findings in a new commit; never amend.

This is a **first-draft scaffold**: skeleton code, deps not installed. The
collected verify/decide checklist is [`docs/notes.md`](docs/notes.md).
