#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/init.sh — instantiate this template into YOUR product.
#
# This is the Copier-replacement (WORK_LOG_02 D1). It substitutes the product
# slug + display name everywhere in the tree. Run it ONCE, right after creating a
# repo from the template ("Use this template" / `gh repo create --template`).
#
# An AI agent can run this as a guided-setup step, or you can run it by hand:
#
#   bun run init                                  # interactive prompts
#   bun run init -- --name "Acme Dashboard"       # derive slug from the name
#   bun run init -- --name "Acme Dashboard" --slug acme-dashboard --yes
#   bun run init -- --name "Acme Dashboard" --dry-run   # preview, write nothing
#
# Flags:
#   --name "<Display Name>"  human-readable name (titles/prose).   e.g. "Acme Dashboard"
#   --slug <slug>            lowercase id for npm scope / k8s names / hostnames /
#                            paths. Derived from --name if omitted.
#   --dry-run                show what WOULD change; modify nothing.
#   --yes                    non-interactive; skip the confirmation prompt.
#   --keep-logs              keep WORK_LOG_*.txt (default: remove the template's
#                            own build journals — they aren't your project's).
#   --fresh-git              detach from template history (rm -rf .git && git init).
#
# What it does NOT do: install deps, write secrets, or rename any files/dirs (the
# slug only ever appears in file CONTENTS, never in a path). After it runs:
# `bun install`, then `cp .env.example .env`. See docs/getting-started.md.
#
# Requires: bash, perl, git (perl ships on macOS + Linux; on Windows use WSL2).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# --- what the template currently uses (the "from" values) --------------------
TPL_FULL="df-cerebe-template" # root package name; replaced FIRST so it doesn't
                             # become "<slug>-template".
TPL_SLUG="df-cerebe"         # lowercase product id (scope, k8s, host, etc.)
TPL_DISPLAY="DF Cerebe"      # human-readable product name (prose/titles)

# --- arg parsing -------------------------------------------------------------
NAME=""
SLUG=""
DRY_RUN=0
ASSUME_YES=0
KEEP_LOGS=0
FRESH_GIT=0

die() { printf 'init: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)   NAME="${2:-}"; shift 2 ;;
    --slug)   SLUG="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    --keep-logs) KEEP_LOGS=1; shift ;;
    --fresh-git) FRESH_GIT=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
done

# Must run from the repo root (where this template's package.json lives).
cd "$(dirname "$0")/.."
[[ -f package.json ]] || die "run from the repo root (package.json not found)."

# --- gather the display name -------------------------------------------------
if [[ -z "$NAME" ]]; then
  [[ -t 0 ]] || die "no --name and not a TTY. Pass --name \"Your Product\"."
  read -r -p "Product display name (e.g. Acme Dashboard): " NAME
fi
[[ -n "$NAME" ]] || die "display name cannot be empty."

# --- derive + validate the slug ----------------------------------------------
derive_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

if [[ -z "$SLUG" ]]; then
  SLUG="$(derive_slug "$NAME")"
  if [[ -t 0 && $ASSUME_YES -eq 0 ]]; then
    read -r -p "Slug [${SLUG}]: " reply
    [[ -n "$reply" ]] && SLUG="$reply"
  fi
fi

# RFC-1123 / npm-scope safe: lowercase alnum + hyphens, start/end alnum.
[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] \
  || die "invalid slug '$SLUG' — use lowercase letters, digits, hyphens (start/end alphanumeric)."
[[ ${#SLUG} -le 40 ]] || die "slug too long (${#SLUG} > 40)."
[[ "$SLUG" != "$TPL_SLUG" ]] || die "slug is still '$TPL_SLUG' — nothing to do."

# --- confirm -----------------------------------------------------------------
echo
echo "  display name : $TPL_DISPLAY  ->  $NAME"
echo "  slug         : $TPL_SLUG  ->  $SLUG"
echo "  root name    : $TPL_FULL  ->  $SLUG"
[[ $DRY_RUN -eq 1 ]] && echo "  mode         : DRY RUN (no files written)"
echo
if [[ $ASSUME_YES -eq 0 && $DRY_RUN -eq 0 ]]; then
  [[ -t 0 ]] || die "not a TTY; pass --yes to proceed non-interactively."
  read -r -p "Apply these replacements? [y/N] " ok
  [[ "$ok" =~ ^[Yy]$ ]] || die "aborted."
fi

# --- build the file list -----------------------------------------------------
# Prefer git (tracked files only, ignores node_modules/.git). Fall back to find.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t FILES < <(git ls-files)
else
  mapfile -t FILES < <(find . -type f -not -path './.git/*' -not -path './node_modules/*' | sed 's|^\./||')
fi

# Files init must NOT rewrite: itself (keeps the "from" literals for re-runs).
is_excluded() {
  case "$1" in
    scripts/init.sh) return 0 ;;
    *) return 1 ;;
  esac
}

# --- apply -------------------------------------------------------------------
changed=0
scanned=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  is_excluded "$f" && continue
  grep -Iq . "$f" || continue          # skip binary files
  grep -qE "$TPL_FULL|$TPL_SLUG|$TPL_DISPLAY" "$f" || continue
  scanned=$((scanned + 1))

  if [[ $DRY_RUN -eq 1 ]]; then
    n=$(grep -oE "$TPL_FULL|$TPL_SLUG|$TPL_DISPLAY" "$f" | wc -l | tr -d ' ')
    printf '  would update %-44s (%s matches)\n' "$f" "$n"
    continue
  fi

  TPL_FULL="$TPL_FULL" TPL_SLUG="$TPL_SLUG" TPL_DISPLAY="$TPL_DISPLAY" \
  NEW_SLUG="$SLUG" NEW_DISPLAY="$NAME" \
  perl -i -pe '
    BEGIN {
      $full = quotemeta $ENV{TPL_FULL};
      $slug = quotemeta $ENV{TPL_SLUG};
      $disp = quotemeta $ENV{TPL_DISPLAY};
    }
    s/$full/$ENV{NEW_SLUG}/g;     # taxgen-template -> slug  (run first)
    s/$slug/$ENV{NEW_SLUG}/g;     # taxgen          -> slug
    s/$disp/$ENV{NEW_DISPLAY}/g;  # TaxGen          -> Display Name
  ' "$f"
  changed=$((changed + 1))
done

# --- remove the template's own build journals --------------------------------
if [[ $KEEP_LOGS -eq 0 && $DRY_RUN -eq 0 ]]; then
  for log in WORK_LOG_*.txt; do
    [[ -e "$log" ]] || continue
    git rm -q "$log" 2>/dev/null || rm -f "$log"
    echo "  removed $log (template build journal — not part of your project)"
  done
fi

# --- optional: detach from template git history ------------------------------
if [[ $FRESH_GIT -eq 1 && $DRY_RUN -eq 0 ]]; then
  rm -rf .git && git init -q -b main
  echo "  re-initialized git (fresh history). Add your own remote next."
fi

# --- summary -----------------------------------------------------------------
echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN complete — $scanned file(s) would change. Nothing written."
  exit 0
fi
echo "Done — rewrote $changed file(s)."
echo
echo "Next:"
echo "  1. bun install            # installs deps + activates the husky gate"
echo "  2. cp .env.example .env   # then fill in keys"
echo "  3. bun run dev            # http://localhost:5173"
echo
echo "Heads-up: docs/ may still contain template-instantiation references"
echo "(e.g. the 'Use this template' command). Skim docs/getting-started.md and"
echo "trim anything that only applied while this was a template."
