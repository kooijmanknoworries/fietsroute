---
name: Azure deploy & Clerk proxy (blank web app)
description: How the Azure web app is deployed and why "turn the Clerk proxy off" is the fix for a blank dev-instance screen.
---

# Azure Container Apps deploy + Clerk proxy

The web/mobile/api artifacts are hosted on Azure Container Apps and deployed by the
GitHub Actions workflow `.github/workflows/azure-deploy.yml` (builds 3 images, pushes
to ACR, `az containerapp update`). Public entrypoint is the Microsoft
`*.azurecontainerapps.io` domain (no custom domain).

## Rule: Clerk proxy must be OFF for a dev instance
Clerk's frontend-API proxy (`VITE_CLERK_PROXY_URL=/api/__clerk`) is **production-only**.
With a dev publishable key (`pk_test`) + proxy ON, the proxied FAPI calls fail and the
app never mounts — blank screen. **Why:** dev instances serve FAPI from
`*.clerk.accounts.dev` directly and reject proxying. **How to apply:** empty proxy for
dev; only set `CLERK_PROXY_URL=/api/__clerk` for a prod instance on a custom domain.

## The three places the proxy value lives — keep them consistent
1. Workflow build-args must source it from `${{ vars.CLERK_PROXY_URL }}`, never hardcode.
2. Dockerfile `ARG ..._CLERK_PROXY_URL` default must be `""` (both routeplanner and
   mobile). **Why:** `docker/build-push-action` drops empty build-args, so the
   Dockerfile default wins — a non-empty default silently re-enables the proxy.
3. App code coerces the env value with `|| undefined` so `""` never becomes a broken
   `proxyUrl=""` prop.

## Deploy gotchas
- **The Azure CI/CD builds from GitHub, not the Replit workspace.** A fix merged only
  into the workspace won't affect deploys. If `${{ vars.X }}` expands to a value while
  the repo variable 404s, the GitHub copy of the workflow differs from local — diff it.
- **ACA keys revisions on the image-reference string.** Re-deploying the same git SHA
  reuses the same `:<sha>` tag → no new revision → old bundle keeps serving. Force a
  roll with a new commit (new SHA → new tag).
- Verifying: the `/assets/index-*.js` hash only changes when build inputs change (same
  hash after a "fix" = build didn't pick it up). The external screenshot tool does not
  wait for Clerk's async render → false blank; use headless chromium with
  `--virtual-time-budget` to see the real sign-in card.

## Access
- Main agent can't `git push`; commit straight to GitHub main via the Git Data API
  with `GH_TOKEN` (blobs → tree w/ base_tree → commit → PATCH refs/heads/main); pushing
  main triggers the deploy.
- Full Azure control via `AZURE_CREDENTIALS` (SP JSON). ARM token from
  `login.microsoftonline.com/<tenant>/oauth2/v2.0/token` (client_credentials, scope
  `https://management.azure.com/.default`). Outbound 5432 blocked; DB restore runs via
  the `azure-db-restore.yml` workflow.
