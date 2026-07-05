# API server (Express + Drizzle/Postgres), bundled with esbuild.
# Build from the REPOSITORY ROOT (pnpm workspace needs the full tree):
#
#   docker build -f artifacts/api-server/Dockerfile -t fietsroute-api .
#
# Runtime environment variables (see docs/azure/AZURE_DEPLOYMENT.md):
#   PORT                   port to listen on (default 8080)
#   DATABASE_URL           Postgres connection string (Azure Database for PostgreSQL)
#   CLERK_SECRET_KEY       Clerk secret key
#   CLERK_PUBLISHABLE_KEY  Clerk publishable key
#   LOG_LEVEL              optional pino log level (default info)
#   DISABLE_NETWORK_PRELOAD optional; set to skip the OSM network preload

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."
RUN pnpm --filter @workspace/api-server run build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/api-server/package.json ./package.json
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
