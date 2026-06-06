import { defineConfig } from "vitest/config";

// Resolve the same "workspace" export condition the rest of the toolchain uses
// (see tsconfig.base.json customConditions) so tests import the TypeScript
// source of @workspace/db and @workspace/api-zod directly.
export default defineConfig({
  resolve: {
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
