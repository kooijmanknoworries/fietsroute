# One-shot schema migration image: applies the Drizzle schema
# (`drizzle-kit push --force`) against $DATABASE_URL at container start.
# Build from the REPOSITORY ROOT (compose does this automatically).

FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/db..."
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-force"]
