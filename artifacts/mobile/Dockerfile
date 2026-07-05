# Mobile static server: builds the Expo Go static bundles (Metro export via
# scripts/build.js) and serves them with the zero-dependency server/serve.js.
#
# IMPORTANT: the public domain is BAKED INTO the bundles at build time
# (asset URLs, API base URL). Changing the domain requires rebuilding this
# image with the new PUBLIC_DOMAIN build arg.
#
# Build from the REPOSITORY ROOT:
#
#   docker build -f artifacts/mobile/Dockerfile \
#     --build-arg PUBLIC_DOMAIN=fietsroute.example.com \
#     --build-arg CLERK_PUBLISHABLE_KEY=pk_live_... \
#     -t fietsroute-mobile .
#
# Build args:
#   PUBLIC_DOMAIN          (required) public domain that serves BOTH the mobile
#                          paths (/mobile/...) and the API (/api/...) — i.e. the
#                          domain of the nginx entrypoint (routeplanner container)
#   BASE_PATH              path prefix the bundles are served under (default /mobile)
#   CLERK_PUBLISHABLE_KEY  Clerk publishable key baked into the app bundle
#   CLERK_PROXY_URL        Clerk frontend-API proxy path (default /api/__clerk)
#
# Runtime environment variables:
#   PORT       port to listen on (default 8080)
#   BASE_PATH  must match the build-time BASE_PATH (default /mobile)

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/mobile..."

ARG PUBLIC_DOMAIN
ARG BASE_PATH=/mobile
ARG CLERK_PUBLISHABLE_KEY=""
ARG CLERK_PROXY_URL="/api/__clerk"
RUN test -n "$PUBLIC_DOMAIN" || { echo "ERROR: PUBLIC_DOMAIN build arg is required"; exit 1; }
ENV EXPO_PUBLIC_DOMAIN=$PUBLIC_DOMAIN \
    BASE_PATH=$BASE_PATH \
    CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY \
    CLERK_PROXY_URL=$CLERK_PROXY_URL \
    CI=1
WORKDIR /app/artifacts/mobile
# Runs Metro, exports ios+android bundles into static-build/ with the public
# domain baked into every asset URL, then verifies the assets exist on disk.
RUN node scripts/build.js

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    BASE_PATH=/mobile
WORKDIR /app
COPY --from=build /app/artifacts/mobile/server ./server
COPY --from=build /app/artifacts/mobile/static-build ./static-build
COPY --from=build /app/artifacts/mobile/app.json ./app.json
EXPOSE 8080
USER node
CMD ["node", "server/serve.js"]
