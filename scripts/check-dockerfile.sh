#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL — Dark Factory docker-build evidence shim.
# Source contract: CONSUMER-ADOPTION.md §5.5.
#
# WHY THIS EXISTS: the Dark Factory critics run in a sandbox with NO Docker
# socket, so they cannot run `docker build` to validate a Dockerfile-touching
# commit. Without evidence, the critic emits a `requiresHumanJudgment: true`
# finding on every such commit. This shim runs `docker build` on a host that DOES
# have Docker (your laptop, pre-push) and writes a SHA-bound evidence file the
# critic reads, so Dockerfile changes get clean signal.
#
# THIS IS A SKELETON. It is NOT wired into .husky/pre-push yet — wire it only
# once you start changing the deploy/docker/*.Dockerfile files and want clean
# critic signal. Until then, Dockerfile commits simply surface a human-judgment
# finding (harmless for a deploy-only folder you review manually).
#
# To activate later: call this from .husky/pre-push BEFORE `df gate-push`, only
# when the push touches a Dockerfile.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve the artifact dir from the DF config (defaults to .git/agent-reviews).
COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
EVIDENCE="${COMMON_DIR}/agent-reviews/_dockerbuild-evidence.json"
SHA="$(git rev-parse HEAD)"

# TODO(impl): for each Dockerfile under deploy/docker/, run `docker build` and
# capture exitCode, then write ONE record per Dockerfile into ${EVIDENCE} in the
# canonical shape (CONSUMER-ADOPTION.md §5.5):
#   {"records":[{"reviewedSha":"<SHA>","dockerfile":"deploy/docker/backend.Dockerfile",
#                "exitCode":0,"builtAt":"<iso8601>"}]}
#
# CRITICAL (security): stamp the SHA you ACTUALLY built against. A stale/forged
# record from an earlier push is dropped by the reader (SHA-binding gate). Do not
# reuse a previous run's record.

echo "check-dockerfile.sh: SKELETON — not implemented. SHA=${SHA}" >&2
echo "Would write evidence to ${EVIDENCE} after running docker build." >&2
exit 0
