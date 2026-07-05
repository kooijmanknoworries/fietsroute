#!/usr/bin/env bash
# Repairs the git remotes in this workspace:
#  1. Renames the GitHub remote (subrepl-23d1vf15) to "origin" -> kooijmanknoworries/fietsroute
#  2. Removes all other stale subrepl-* remotes (leftovers from task agents)
#  3. Deletes leftover local subrepl-* branches (their work is already merged into main)
#  4. Runs garbage collection
# Safe to re-run: every step skips what is already done.
set -u

echo "== Step 1: set up origin =="
if git remote get-url origin >/dev/null 2>&1; then
  echo "origin already exists: $(git remote get-url origin)"
else
  if git remote get-url subrepl-23d1vf15 >/dev/null 2>&1; then
    git remote rename subrepl-23d1vf15 origin
  else
    git remote add origin https://github.com/kooijmanknoworries/fietsroute
  fi
fi
git remote set-url origin https://github.com/kooijmanknoworries/fietsroute
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git config --unset remote.origin.lfsurl 2>/dev/null || true
echo "origin -> $(git remote get-url origin)"

echo
echo "== Step 2: remove stale subrepl-* remotes =="
count=0
for r in $(git remote | grep '^subrepl-' || true); do
  git remote remove "$r" && count=$((count+1))
done
echo "removed $count stale remotes"

echo
echo "== Step 3: delete leftover local subrepl-* branches =="
count=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/subrepl-\* || true); do
  git branch -D "$b" >/dev/null && count=$((count+1))
done
echo "deleted $count leftover branches"

echo
echo "== Step 4: garbage collection =="
git gc --quiet 2>/dev/null || echo "(gc skipped - not critical)"

echo
echo "== Result =="
git remote -v
echo
echo "Done! Remaining remotes should be only: origin and gitsafe-backup."
echo "Next: reconnect GitHub in the Git pane (left sidebar) so pushing works again."
