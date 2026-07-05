# Routeplanner web app (React + Vite) served by nginx.
# nginx also acts as the single public entrypoint, path-routing like Replit does:
#   /        -> the static web app (this container)
#   /api/... -> the api-server container   (API_ORIGIN)
#   /mobile  -> the mobile static server   (MOBILE_ORIGIN)
#
# Build from the REPOSITORY ROOT:
#
#   docker build -f artifacts/routeplanner/Dockerfile \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
#     -t fietsroute-web .
#
# Build args (baked into the JS bundle at build time):
#   VITE_CLERK_PUBLISHABLE_KEY  Clerk publishable key (required for sign-in)
#   VITE_CLERK_PROXY_URL        Clerk frontend-API proxy path (default /api/__clerk)
#
# Runtime environment variables:
#   API_ORIGIN     origin of the api-server, e.g. https://<api-app>.internal.<env>.azurecontainerapps.io
#   MOBILE_ORIGIN  origin of the mobile static server
#   (listens on port 8080)

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/routeplanner..."
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_CLERK_PROXY_URL="/api/__clerk"
# BASE_PATH and PORT are required by vite.config.ts even for a static build.
ENV NODE_ENV=production \
    BASE_PATH=/ \
    PORT=8080 \
    VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_CLERK_PROXY_URL=$VITE_CLERK_PROXY_URL
RUN pnpm --filter @workspace/routeplanner run build

FROM nginx:1.27-alpine
COPY artifacts/routeplanner/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/artifacts/routeplanner/dist/public /usr/share/nginx/html
ENV API_ORIGIN=http://api-server:8080 \
    MOBILE_ORIGIN=http://mobile:8080
EXPOSE 8080
