---
name: GitHub push auth on Replit
description: How git pushes to GitHub authenticate here and what "Invalid username or token" means
---
Pushes to GitHub use Replit's `GIT_ASKPASS` helper — there is no stored credential helper and no GitHub connector in this project. If a push fails with "Invalid username or token. Password authentication is not supported", the credential Replit supplied is expired/invalid.

**Why:** The GitHub link is managed by the Replit Git pane, not by anything in the repo. Repo-side fixes (remotes, branches, gc) cannot resolve this error.

**How to apply:** Ask the user to reconnect GitHub via the Replit Git pane; never store tokens manually in git config or remote URLs. The GitHub remote must be named `origin` for the Git pane to work; platform task agents historically left stale `subrepl-*` remotes/branches behind — if pushes break again, check `git remote | wc -l` first.

Git remote configuration is per-environment and NOT part of a code merge — cleaning remotes inside an isolated task agent has zero effect on the main workspace. An empty output from `git ls-remote origin` with exit 0 just means the GitHub repo has no branches yet (auth/connectivity are fine).

Standard push path (July 2026): a fine-grained PAT lives in the `GITHUB_PUSH_TOKEN` Replit secret (Contents: read/write on kooijmanknoworries/fietsroute); run `./scripts/push-to-github.sh` (supports `--dry-run`). It builds a temp askpass, never stores the token, and verifies success via `git ls-remote` because of the destructive-op quirk below.

PAT fallback (verified July 2026): if the pane token stays stale, a user-supplied fine-grained PAT (Contents: read/write) works — write a temp askpass script (`username → x-access-token`, password → PAT from a mode-600 tmp file), run `GIT_ASKPASS=/tmp/askpass.sh git push`, delete both files after. `--dry-run` (incl. `--force-with-lease`) is fully allowed; the REAL push updates the remote successfully but then dies with "Destructive git operations are not allowed" when git tries to write `.git/refs/remotes/origin/main.lock` — the push has ALREADY landed; verify with `git ls-remote origin` instead of retrying. Local fetch/merge is impossible (object writes blocked), so a diverged remote can only be reconciled by verifying the remote-only commits' content already exists locally, then `--force-with-lease=main:<remote-sha>`. Advise the user to revoke a PAT pasted in chat afterwards.

The main agent CANNOT repair remotes either: the platform blocks all writes to `.git` (both git commands touching config.lock and direct file edits). The working pattern (verified July 2026): write an idempotent cleanup script (see `scripts/fix-git-remotes.sh`) and have the USER run it in the Shell tab — their shell is unrestricted. Read-only git and `git branch -d` are allowed for the agent; `git push` is allowed but the agent's askpass token can stay stale after the user reconnects GitHub — a push that fails "Invalid username or token" for the agent can succeed in the user's own Shell. Verify with `git ls-remote origin` instead of retrying the push.
