#!/usr/bin/env bash
# Verify that the GITHUB_PUSH_TOKEN secret still authenticates against the
# GitHub repo, and warn early if it is about to expire.
#
# Usage:
#   ./scripts/check-github-token.sh                # human-readable check
#   ./scripts/check-github-token.sh --warn-days 14 # custom expiry warning window
#
# Exit codes:
#   0 = token works (and is not inside the warning window)
#   1 = token missing, invalid/expired, or lacks access to the repo
#   2 = token works but expires within the warning window
#   3 = GitHub API unreachable / unexpected response; token status unknown
#
# Renewal: generate a new fine-grained Personal Access Token at
# https://github.com/settings/personal-access-tokens (Contents: read/write on
# kooijmanknoworries/fietsroute) and update the GITHUB_PUSH_TOKEN secret in
# the Replit Secrets tab.
set -u

REPO="kooijmanknoworries/fietsroute"
WARN_DAYS=14
if [ "${1:-}" = "--warn-days" ] && [ -n "${2:-}" ]; then
  case "$2" in
    ''|*[!0-9]*)
      echo "ERROR: --warn-days must be a non-negative integer, got: $2" >&2
      exit 1
      ;;
    *) WARN_DAYS="$2" ;;
  esac
fi

RENEW_MSG="To renew: create a new fine-grained PAT at https://github.com/settings/personal-access-tokens with Contents: read/write on ${REPO}, then update the GITHUB_PUSH_TOKEN secret in the Replit Secrets tab."

if [ -z "${GITHUB_PUSH_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_PUSH_TOKEN is not set." >&2
  echo "$RENEW_MSG" >&2
  exit 1
fi

HEADERS_FILE="$(mktemp /tmp/gh-token-check.XXXXXX)"
cleanup() { rm -f "$HEADERS_FILE"; }
trap cleanup EXIT

HTTP_STATUS="$(curl -sS -o /dev/null -D "$HEADERS_FILE" -w '%{http_code}' \
  -H "Authorization: Bearer ${GITHUB_PUSH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}" 2>&1)" || {
  echo "WARNING: could not reach the GitHub API (network problem?). Token status unknown." >&2
  exit 3
}

case "$HTTP_STATUS" in
  200) ;;
  401)
    echo "ERROR: GITHUB_PUSH_TOKEN is invalid or has EXPIRED (GitHub API returned 401)." >&2
    echo "Pushes via ./scripts/push-to-github.sh will fail until it is renewed." >&2
    echo "$RENEW_MSG" >&2
    exit 1
    ;;
  403|404)
    echo "ERROR: GITHUB_PUSH_TOKEN authenticated but cannot access ${REPO} (HTTP ${HTTP_STATUS})." >&2
    echo "The token may be scoped to the wrong repository or missing the Contents permission." >&2
    echo "$RENEW_MSG" >&2
    exit 1
    ;;
  *)
    echo "WARNING: unexpected GitHub API response (HTTP ${HTTP_STATUS}). Token status unknown." >&2
    echo "$RENEW_MSG" >&2
    exit 3
    ;;
esac

# Fine-grained PATs report their expiry in this response header.
EXPIRY="$(grep -i '^github-authentication-token-expiration:' "$HEADERS_FILE" | head -n1 | sed 's/^[^:]*: *//' | tr -d '\r')"

if [ -z "$EXPIRY" ]; then
  echo "OK: GITHUB_PUSH_TOKEN authenticates against ${REPO} (no expiry reported by GitHub)."
  exit 0
fi

EXPIRY_EPOCH="$(date -d "$EXPIRY" +%s 2>/dev/null || echo "")"
NOW_EPOCH="$(date +%s)"

if [ -z "$EXPIRY_EPOCH" ]; then
  echo "OK: GITHUB_PUSH_TOKEN authenticates against ${REPO}. Expiry reported but unparseable: ${EXPIRY}"
  exit 0
fi

DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
  echo "WARNING: GITHUB_PUSH_TOKEN expires in ${DAYS_LEFT} day(s) (on ${EXPIRY})." >&2
  echo "Renew it BEFORE it expires or pushes will start failing mid-deploy." >&2
  echo "$RENEW_MSG" >&2
  exit 2
fi

echo "OK: GITHUB_PUSH_TOKEN authenticates against ${REPO}; expires in ${DAYS_LEFT} day(s) (on ${EXPIRY})."
exit 0
