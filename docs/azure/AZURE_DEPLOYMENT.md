# Deploying Fietsrouteplanner to Azure

This guide moves the app from Replit to Azure using the GitHub repository
`kooijmanknoworries/fietsroute` as the source of truth.

## Architecture

Three containers, mirroring the Replit path routing behind ONE public domain:

```
                      https://<PUBLIC_DOMAIN>
                              |
                    +---------v----------+
                    |  fietsroute-web    |  nginx (public ingress)
                    |  serves /          |  static React app
                    |  proxies /api  ----+--> fietsroute-api    (internal)
                    |  proxies /mobile --+--> fietsroute-mobile (internal)
                    +--------------------+
                                              fietsroute-api --> Azure Database
                                                                 for PostgreSQL
```

- **fietsroute-api** — Express API (`artifacts/api-server`), talks to Postgres.
  Also proxies the Clerk frontend API at `/api/__clerk`.
- **fietsroute-web** — static routeplanner build served by nginx
  (`artifacts/routeplanner`). nginx is the single public entrypoint and
  path-routes `/api` and `/mobile` to the other two containers, so the web app
  keeps calling same-origin `/api/...` exactly as it does on Replit.
- **fietsroute-mobile** — Expo Go static bundles + landing page
  (`artifacts/mobile`). The public domain is **baked into the bundles at image
  build time** (see caveats).

Recommended Azure services:
- **Azure Container Apps** (one environment, three apps) — web has external
  ingress on port 8080; api and mobile use internal ingress on port 8080.
- **Azure Container Registry (ACR)** for images.
- **Azure Database for PostgreSQL — Flexible Server** (PostgreSQL 16).

## 1. One-time Azure setup

```bash
RG=fietsroute-rg
LOC=northeurope             # see region note below
ACR=fietsrouteacr            # must be globally unique
ENV=fietsroute-env

az group create --name $RG --location $LOC
az acr create --name $ACR --resource-group $RG --sku Basic
az containerapp env create --name $ENV --resource-group $RG --location $LOC

# Postgres 16 Flexible Server + database
az postgres flexible-server create --name fietsroute-pg --resource-group $RG \
  --location $LOC --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 --database-name fietsroute
# Allow Azure services to reach it (or configure VNet integration):
az postgres flexible-server firewall-rule create --server-name fietsroute-pg \
  --resource-group $RG --name allow-azure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

> **Region note (verified during the test run):** some subscriptions cannot
> create new Container Apps / Postgres capacity in `westeurope` (the request is
> rejected). `northeurope` worked; pick any region your subscription has quota
> in and keep all resources in the same one.
>
> **CLI note:** on current `az`, `firewall-rule` uses `--server-name` for the
> server and `--name` for the rule (older syntax used `--name` for the server
> and `--rule-name` for the rule).

Create the three container apps (first deploy can use a placeholder image;
the GitHub workflow updates them afterwards):

```bash
REGISTRY=$ACR.azurecr.io
az acr login --name $ACR

# API (internal ingress)
az containerapp create --name fietsroute-api --resource-group $RG \
  --environment $ENV --target-port 8080 --ingress internal \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --registry-server $REGISTRY \
  --cpu 1 --memory 2Gi --min-replicas 1 --max-replicas 1 \
  --secrets database-url='<azure-postgres-url>' clerk-secret-key='<clerk-secret>' \
  --env-vars NODE_ENV=production PORT=8080 \
    DATABASE_URL=secretref:database-url \
    CLERK_SECRET_KEY=secretref:clerk-secret-key \
    CLERK_PUBLISHABLE_KEY='<clerk-publishable>'

# Mobile static server (internal ingress)
az containerapp create --name fietsroute-mobile --resource-group $RG \
  --environment $ENV --target-port 8080 --ingress internal \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --registry-server $REGISTRY \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --env-vars NODE_ENV=production PORT=8080 BASE_PATH=/mobile

# Web (external ingress — this is the public domain)
az containerapp create --name fietsroute-web --resource-group $RG \
  --environment $ENV --target-port 8080 --ingress external \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --registry-server $REGISTRY \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 2 \
  --env-vars \
    API_ORIGIN=https://fietsroute-api.internal.<env-hash>.$LOC.azurecontainerapps.io \
    MOBILE_ORIGIN=https://fietsroute-mobile.internal.<env-hash>.$LOC.azurecontainerapps.io
```

Find the internal FQDNs with
`az containerapp show -n fietsroute-api -g $RG --query properties.configuration.ingress.fqdn`
and the public domain with the same query on `fietsroute-web`.

Keep **min-replicas 1** for the API: it preloads the NL/BE cycling network into
Postgres and runs background cache refresh loops; scale-to-zero would stop those.

## 2. Environment variables and secrets

Secrets **cannot be exported from Replit** — re-enter the values in Azure.

### fietsroute-api (runtime)
| Variable | Required | Notes |
|---|---|---|
| `PORT` | yes (default 8080) | must match ingress target port |
| `DATABASE_URL` | yes | Azure Postgres URL, include `?sslmode=require` |
| `CLERK_SECRET_KEY` | yes | from your Clerk instance (see caveats) |
| `CLERK_PUBLISHABLE_KEY` | yes | same Clerk instance |
| `NODE_ENV` | yes | `production` (enables the Clerk proxy) |
| `LOG_LEVEL` | no | pino level, default `info` |
| `DISABLE_NETWORK_PRELOAD` | no | set to skip the OSM network preload |
| `DATASET_MIN_NODE_COUNT` | no | preload sanity threshold override |

### fietsroute-web
| When | Variable | Notes |
|---|---|---|
| build arg | `VITE_CLERK_PUBLISHABLE_KEY` | baked into JS bundle |
| build arg | `VITE_CLERK_PROXY_URL` | default `/api/__clerk` |
| runtime | `API_ORIGIN` | internal FQDN of fietsroute-api (https) |
| runtime | `MOBILE_ORIGIN` | internal FQDN of fietsroute-mobile (https) |

### fietsroute-mobile
| When | Variable | Notes |
|---|---|---|
| build arg | `PUBLIC_DOMAIN` | public domain of fietsroute-web — baked into bundles |
| build arg | `BASE_PATH` | `/mobile` |
| build arg | `CLERK_PUBLISHABLE_KEY` | baked into the app bundle |
| build arg | `CLERK_PROXY_URL` | default `/api/__clerk` |
| runtime | `PORT`, `BASE_PATH` | `8080`, `/mobile` |

### GitHub Actions (repo settings)
Secrets: `AZURE_CREDENTIALS` (service principal JSON), `CLERK_PUBLISHABLE_KEY`.
Variables: `ACR_NAME`, `AZURE_RESOURCE_GROUP`, `API_APP_NAME`, `WEB_APP_NAME`,
`MOBILE_APP_NAME`, `PUBLIC_DOMAIN`.

Grant the service principal ACR push rights:
`az role assignment create --assignee <sp-appId> --role AcrPush --scope $(az acr show -n $ACR --query id -o tsv)`

## 3. Database migration (Replit → Azure Postgres)

The procedure uses `pg_dump` custom format; it has been tested end-to-end
(dump from the Replit database, restore into a fresh database, row counts
verified identical).

1. **Export** — in the Replit workspace shell:
   ```bash
   bash scripts/azure/export-replit-db.sh fietsroute.dump
   ```
   The script prints per-table row counts — keep them for verification.
2. **Download** `fietsroute.dump` from the workspace (Files pane → Download),
   or run the restore directly from the Replit shell if the Azure server's
   firewall allows your connection.

   > **Note (verified during the test run):** Replit's outbound firewall blocks
   > TCP 5432 (from the shell *and* from Docker containers), so the restore
   > cannot run from the Replit workspace. Run it instead from any host with
   > 5432 egress — Azure Cloud Shell, your laptop, or the included
   > `.github/workflows/azure-db-restore.yml` GitHub Actions workflow. That
   > workflow uploads the dump as a `db-migration-snapshot` release asset,
   > opens the Postgres firewall to the runner IP, runs
   > `scripts/azure/restore-azure-db.sh`, prints row counts, then removes the
   > temporary firewall rule. It needs the extra secret `AZURE_DATABASE_URL`
   > and variable `AZURE_PG_SERVER`.
3. **Restore** into Azure (database `fietsroute` must exist):
   ```bash
   bash scripts/azure/restore-azure-db.sh \
     'postgresql://fietsadmin:PASSWORD@fietsroute-pg.postgres.database.azure.com:5432/fietsroute?sslmode=require' \
     fietsroute.dump
   ```
   The script is repeatable (`--clean --if-exists`) and prints the restored
   tables afterwards; run `ANALYZE` once, then compare row counts with step 1.
4. Future **schema changes** are applied with Drizzle from a machine that can
   reach Azure: `DATABASE_URL='<azure-url>' pnpm --filter @workspace/db run push`.

Note: `network_nodes`/`network_segments`/`overpass_cache`/`geocode_cache` are
rebuildable caches — if the dump is large you may skip them and let the API
server re-import the cycling network on first start (takes a while but is
automatic). `saved_routes`, `visited_segments` and `user_access` are the real
user data and must be migrated.

## 4. Deploying

Every push to `main` on `kooijmanknoworries/fietsroute` runs
`.github/workflows/azure-deploy.yml`: it builds the three images (repo-root
build context; Dockerfiles live in each artifact directory), pushes them to
ACR tagged with the commit SHA, and rolls the three container apps to the new
images. It can also be run manually from the Actions tab.

The mobile image build runs a full Metro export (~10 minutes) — this is
expected.

## 5. Known caveats

- **Clerk users do not migrate.** Auth uses a Replit-managed Clerk tenant that
  cannot be exported. Create your own Clerk application (clerk.com), configure
  the same login providers, set its keys in Azure and in the GitHub secrets.
  Users must register again on the new domain. Approved-user records in
  `user_access` are keyed by Clerk user id, so re-registered users get **new
  ids** — re-approve them after they sign up again (their saved routes/ride
  history are likewise tied to the old ids; plan a manual remap if that data
  must carry over).
- **The mobile bundles bake in the domain.** The published Expo Go build on
  Replit points at the Replit domain. The mobile image must be (re)built with
  `PUBLIC_DOMAIN` set to the Azure domain — the GitHub workflow does this.
  Riders simply re-scan the QR code on `https://<PUBLIC_DOMAIN>/mobile`.
  If you later add a custom domain, rebuild the mobile image.
- **One public domain.** The web app calls same-origin `/api/...` and the
  mobile bundles call `https://<PUBLIC_DOMAIN>/api/...`, so `/`, `/api` and
  `/mobile` must stay behind the same public host (the nginx entrypoint
  handles this — don't expose the api/mobile apps publicly under different
  domains without revisiting the client configuration).
- **Postgres version.** Replit runs PostgreSQL 16; use version 16 on Azure to
  avoid dump/restore incompatibilities.
