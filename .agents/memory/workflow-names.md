---
name: Artifact workflow names
description: How to restart artifact dev servers in this project
---
Artifact dev-server workflows are named `artifacts/<dir>: <title>` (e.g. `artifacts/api-server: API Server`), not the plain artifact title.

**Why:** `restart_workflow` with "API Server" or "api-server" fails with RUN_COMMAND_NOT_FOUND; these workflows are platform-managed and not in `.replit` (which only has the `Project`/`test` workflows).

**How to apply:** Call `listWorkflows()` in the code-execution sandbox to get exact names, then `restartWorkflow({ workflowName: "artifacts/api-server: API Server" })`. Remember api-server has no hot reload, so restart after every server edit.
