import { describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Stub Clerk so tests can control the authenticated user via a request header,
// mirroring the pattern used by the saved-routes / visited-segments suites. An
// absent/empty header means an anonymous request.
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => {
    const userId = req.headers["x-test-user"];
    return { userId: typeof userId === "string" && userId ? userId : null };
  },
}));

const { default: router } = await import("./index");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // Mirror production: pino-http adds req.log, which handlers use when logging.
  app.use((req, _res, next) => {
    (req as unknown as { log: Console }).log = console;
    next();
  });
  app.use("/api", router);
  return app;
}

const app = makeApp();

// Endpoints that must reject anonymous callers. Each uses invalid/minimal input
// so the request never reaches any DB / Overpass call — an authenticated
// version returns a 4xx that is deliberately NOT 401.
const protectedRequests: Array<{
  name: string;
  send: (auth: boolean) => request.Test;
}> = [
  {
    name: "POST /api/route",
    send: (auth) => {
      const r = request(app).post("/api/route").send({});
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/network",
    send: (auth) => {
      const r = request(app).get("/api/network");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/network/status",
    send: (auth) => {
      const r = request(app).get("/api/network/status");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/lf-routes",
    send: (auth) => {
      const r = request(app).get("/api/lf-routes");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/geocode",
    send: (auth) => {
      const r = request(app).get("/api/geocode");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/regions",
    send: (auth) => {
      const r = request(app).get("/api/regions");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/routes",
    send: (auth) => {
      const r = request(app).get("/api/routes");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
  {
    name: "GET /api/visited-segments",
    send: (auth) => {
      const r = request(app).get("/api/visited-segments");
      return auth ? r.set("x-test-user", "user_test") : r;
    },
  },
];

describe("API auth gate", () => {
  it("leaves the health check publicly reachable", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  for (const { name, send } of protectedRequests) {
    it(`rejects anonymous ${name} with 401`, async () => {
      const res = await send(false);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Unauthorized" });
    });

    it(`does not return 401 for authenticated ${name}`, async () => {
      const res = await send(true);
      expect(res.status).not.toBe(401);
    });
  }
});
