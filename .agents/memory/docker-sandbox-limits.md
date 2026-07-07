---
name: Replit Docker sandbox limits
description: What works and what's blocked when testing docker compose stacks inside the Replit workspace
---
The workspace Docker daemon runs in its own VM with heavy restrictions:
- **Inter-container bridge traffic is fully blocked** (any port, incl. 8080/5433) — compose services cannot talk to each other over the default network. Symptom: `connect ETIMEDOUT <172.x>:<port>`.
- **`docker exec` fails** (`setns` blocked) → in-container healthchecks always report unhealthy, so `depends_on: condition: service_healthy` never passes. Start services with `--no-deps` when testing.
- **`network_mode: host` WORKS** — that "host" is the docker VM, not the workspace, but containers on host net reach each other via 127.0.0.1, and the workspace can curl those ports directly. Port 8080 is taken on that VM host.
- Long builds/commands: background bash processes get killed between tool calls; run them via a temporary console workflow that tees to a log file, and poll the file.

**How to apply:** to smoke-test a compose stack here, use an override that puts every service on `network_mode: host` with distinct ports (see `deploy/selfhost/replit-test.override.yml` for a working example). The failing healthchecks/bridge are sandbox artifacts, not compose bugs.

Also: drizzle-kit push swallows connection errors under a non-TTY (spinner + exit 1, no message) — test raw connectivity with a small `pg` Client script first.
