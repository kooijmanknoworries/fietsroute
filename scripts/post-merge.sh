#!/bin/bash
set -e
pnpm install
pnpm --filter @workspace/db run push-force

# Keep the GitHub backup (origin/main) in sync automatically after every merge.
# push-to-github.sh preflights the GITHUB_PUSH_TOKEN and verifies the remote
# SHA via ls-remote. A failure here (e.g. expired token) intentionally fails
# post-merge setup so the problem is surfaced instead of silently skipped.
if ! ./scripts/push-to-github.sh; then
  echo "" >&2
  echo "ERROR: automatic GitHub backup push failed — origin/main on GitHub is now behind." >&2
  echo "Most likely cause: the GITHUB_PUSH_TOKEN secret is expired or invalid." >&2
  echo "Renew it (see message above), then re-run ./scripts/push-to-github.sh manually." >&2
  exit 1
fi
