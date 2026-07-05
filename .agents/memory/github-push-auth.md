---
name: GitHub push auth on Replit
description: How git pushes to GitHub authenticate here and what "Invalid username or token" means
---
Pushes to GitHub use Replit's `GIT_ASKPASS` helper — there is no stored credential helper and no GitHub connector in this project. If a push fails with "Invalid username or token. Password authentication is not supported", the credential Replit supplied is expired/invalid.

**Why:** The GitHub link is managed by the Replit Git pane, not by anything in the repo. Repo-side fixes (remotes, branches, gc) cannot resolve this error.

**How to apply:** Ask the user to reconnect GitHub via the Replit Git pane; never store tokens manually in git config or remote URLs. The GitHub remote must be named `origin` for the Git pane to work; platform task agents historically left stale `subrepl-*` remotes/branches behind — if pushes break again, check `git remote | wc -l` first.

Git remote configuration is per-environment and NOT part of a code merge — cleaning remotes inside an isolated task agent has zero effect on the main workspace. An empty output from `git ls-remote origin` with exit 0 just means the GitHub repo has no branches yet (auth/connectivity are fine).

The main agent CANNOT repair remotes either: the platform blocks all writes to `.git` (both git commands touching config.lock and direct file edits). The working pattern (verified July 2026): write an idempotent cleanup script (see `scripts/fix-git-remotes.sh`) and have the USER run it in the Shell tab — their shell is unrestricted. Read-only git and `git branch -d` are allowed for the agent; `git push` is allowed but the agent's askpass token can stay stale after the user reconnects GitHub — a push that fails "Invalid username or token" for the agent can succeed in the user's own Shell. Verify with `git ls-remote origin` instead of retrying the push.
