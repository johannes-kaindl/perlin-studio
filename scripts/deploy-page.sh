#!/usr/bin/env bash
# Deploy the site to pages.jkaindl.de.
#
# The repo root IS the deployable site (no build step). This script runs the
# same gates as the old CI, takes a clean snapshot of committed HEAD
# (git archive — untracked files like macos/.build can never leak) and rsyncs
# it to the pages server (/srv/pages/perlin-studio/, served at
# https://pages.jkaindl.de/perlin-studio/). Replaces the old Forgejo workflow
# (.forgejo/workflows/deploy.yml, removed — the self-hosted Forgejo runs no CI
# runner by design).
#
# Repo meta (AGENTS.md, docs/, scripts/, ios/, macos/, …) is excluded — it was
# part of the old Codeberg Pages deploy but has no business on the public site.
# dist/ (standalone perlin-noise.js bundle) stays: it may be hotlinked.
#
# Auth is via the dedicated deploy key behind the `pages-deploy` SSH host alias
# (~/.ssh/config) — restricted server-side to rsync into /srv/pages only.
#
# Requires real rsync 3.x — macOS ships openrsync, which is incompatible with
# the server-side rrsync wrapper: brew install rsync
#
# Usage: bash scripts/deploy-page.sh

set -euo pipefail

RSYNC="${RSYNC:-/opt/homebrew/bin/rsync}"
# No pipe here: grep -q + pipefail would turn rsync's SIGPIPE into a failure.
case "$("$RSYNC" --version 2>/dev/null || true)" in
  *"version 3."*) ;;
  *)
    echo "ERROR: $RSYNC is not rsync 3.x (macOS openrsync won't work): brew install rsync" >&2
    exit 1
    ;;
esac

DEST="pages-deploy:perlin-studio/"

cd "$(git rev-parse --show-toplevel)"

echo "=== Gates ==="
node scripts/check-syntax.mjs
node scripts/smoke-test.js

if [[ -n "$(git status --porcelain)" ]]; then
  echo "NOTE: working tree has uncommitted changes — deploying committed HEAD, not the working tree." >&2
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "=== Snapshot HEAD ==="
git archive HEAD | tar -x -C "$STAGE"

echo "=== Publishing via rsync ==="
"$RSYNC" -az --delete \
  --exclude 'AGENTS.md' --exclude 'CHANGELOG.md' --exclude 'CLA.md' \
  --exclude 'CONTRIBUTING.md' --exclude 'LICENSING.md' --exclude 'README.md' \
  --exclude 'SECURITY.md' --exclude '.editorconfig' --exclude '.gitignore' \
  --exclude '.forgejo/' --exclude '.gitea/' \
  --exclude '_archiv/' --exclude 'docs/' --exclude 'scripts/' \
  --exclude 'ios/' --exclude 'macos/' \
  "$STAGE"/ "$DEST"

echo "✓ Deployed. Live: https://pages.jkaindl.de/perlin-studio/"
