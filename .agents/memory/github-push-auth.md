---
name: GitHub push auth on Replit
description: How git pushes to GitHub authenticate here and what "Invalid username or token" means
---
Pushes to GitHub use Replit's `GIT_ASKPASS` helper — there is no stored credential helper and no GitHub connector in this project. If a push fails with "Invalid username or token. Password authentication is not supported", the credential Replit supplied is expired/invalid.

**Why:** The GitHub link is managed by the Replit Git pane, not by anything in the repo. Repo-side fixes (remotes, branches, gc) cannot resolve this error.

**How to apply:** Ask the user to reconnect GitHub via the Replit Git pane; never store tokens manually in git config or remote URLs. The GitHub remote must be named `origin` for the Git pane to work; platform task agents historically left stale `subrepl-*` remotes/branches behind — if pushes break again, check `git remote | wc -l` first.
