import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// The /network-status handler delegates to getDatasetStatus, which counts rows
// in the shared network_nodes table. Mock it so the response is deterministic
// regardless of any imported/seeded data in the shared test DB.
const getDatasetStatus = vi.fn();
vi.mock("../lib/osm/dataset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/osm/dataset")>();
  return { ...actual, getDatasetStatus: () => getDatasetStatus() };
});

// Import after the mock is registered so the router picks up the mocked module.
const { default: networkRouter } = await import("./network");

function buildApp(): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", networkRouter);
  return app;
}

describe("GET /api/network-status", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getDatasetStatus.mockReset();
  });

  it("reports the dataset as ready when it is complete", async () => {
    getDatasetStatus.mockResolvedValue({
      ready: true,
      nodeCount: 9000,
      threshold: 6000,
    });

    const res = await request(buildApp()).get("/api/network-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true, nodeCount: 9000, threshold: 6000 });
  });

  it("reports the dataset as not ready while it is still loading", async () => {
    getDatasetStatus.mockResolvedValue({
      ready: false,
      nodeCount: 1200,
      threshold: 6000,
    });

    const res = await request(buildApp()).get("/api/network-status");

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.nodeCount).toBe(1200);
    expect(res.body.threshold).toBe(6000);
  });
});
