#!/usr/bin/env bash
# Push the current branch to GitHub using the GITHUB_PUSH_TOKEN secret.
#
# Usage:
#   ./scripts/push-to-github.sh                 # push HEAD to origin main
#   ./scripts/push-to-github.sh --dry-run       # verify auth without pushing
#   ./scripts/push-to-github.sh <extra git push args...>
#
# Auth: uses a temporary GIT_ASKPASS script fed by the GITHUB_PUSH_TOKEN
# Replit secret (fine-grained PAT, Contents: read/write on the repo).
# The token is never written into git config, remote URLs, or the repo.
#
# Note (Replit workspace quirk): a REAL push may end with
# "Destructive git operations are not allowed" AFTER the push has already
# landed on GitHub (git fails writing its local remote-tracking ref).
# This script therefore verifies the remote with `git ls-remote` and
# reports success/failure based on what GitHub actually has.
set -u

if [ -z "${GITHUB_PUSH_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_PUSH_TOKEN is not set. Add it in the Secrets tab (fine-grained PAT, Contents: read/write)." >&2
  exit 1
fi

ASKPASS="$(mktemp /tmp/gh-askpass.XXXXXX)"
cleanup() { rm -f "$ASKPASS"; }
trap cleanup EXIT

cat > "$ASKPASS" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  Username*) echo "x-access-token" ;;
  Password*) echo "$GITHUB_PUSH_TOKEN" ;;
esac
EOF
chmod 700 "$ASKPASS"

LOCAL_SHA="$(git rev-parse HEAD)"
ARGS=("$@")
if [ ${#ARGS[@]} -eq 0 ]; then
  ARGS=(origin "HEAD:main")
elif [ "${ARGS[0]}" = "--dry-run" ]; then
  ARGS=(--dry-run origin "HEAD:main" "${ARGS[@]:1}")
fi

echo "Pushing (git push ${ARGS[*]}) ..."
GIT_ASKPASS="$ASKPASS" git push "${ARGS[@]}"
PUSH_STATUS=$?

for a in "${ARGS[@]}"; do
  if [ "$a" = "--dry-run" ]; then
    exit $PUSH_STATUS
  fi
done

REMOTE_SHA="$(GIT_ASKPASS="$ASKPASS" git ls-remote origin refs/heads/main | awk '{print $1}')"
echo "Local  HEAD: $LOCAL_SHA"
echo "Remote main: ${REMOTE_SHA:-<none>}"
if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
  echo "SUCCESS: GitHub main matches local HEAD."
  exit 0
fi
if [ $PUSH_STATUS -ne 0 ]; then
  echo "FAILED: push failed and remote does not match local HEAD." >&2
  exit 1
fi
echo "WARNING: push reported success but remote main != local HEAD (non-main ref pushed?)."
exit 0
