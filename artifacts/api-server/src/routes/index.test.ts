import { describe, expect, it, vi } from "vitest";
import express, { type Express, type IRouter } from "express";
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
// Imported by identity so we can locate them in the mounted layer stack. These
// are the SAME object references that routes/index.ts registers.
const { requireAuth } = await import("../middlewares/requireAuth");
const { default: healthRouter } = await import("./health");
const { publicSharedRoutesRouter } = await import("./shared-routes");

// Express layer shape we rely on. `handle` is the mounted router/middleware,
// `route` is set for direct routes, `slash` is true only for root ("/") mounts.
type Layer = {
  handle?: { stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean> };
  slash?: boolean;
};

function stackOf(r: IRouter): Layer[] {
  return (r as unknown as { stack: Layer[] }).stack;
}

// Routers/middleware that are allowed to sit ABOVE the auth gate because they are
// deliberately public. Compared by object identity, not by path — so the check
// is immune to how (or under what prefix) a router is mounted.
const PUBLIC_ROUTER_HANDLES = new Set<unknown>([
  healthRouter,
  // Shared-route links are viewable without an account by design.
  publicSharedRoutesRouter,
]);

// ---------------------------------------------------------------------------
// Structural guard: the authoritative, prefix-agnostic check.
//
// The security invariant is purely about ORDER within the layer stack: the
// requireAuth gate must exist, and every route-bearing layer registered before
// it must be an explicitly allowlisted public router. This holds no matter what
// mount prefix a future router uses (Express 5 does not expose mount-prefix
// strings, so path reconstruction is unreliable — ordering is not).
// ---------------------------------------------------------------------------

// True if this layer (or anything nested under it) actually serves an endpoint.
// Plain middleware (e.g. requireAuth itself, express.json) has no route.
function layerHasRoute(layer: Layer): boolean {
  if (layer.route) return true;
  const nested = layer.handle?.stack;
  return Array.isArray(nested) && nested.some(layerHasRoute);
}

const GATE_MISSING = -1;

// Returns the indexes of route-bearing layers that are exposed without auth: any
// non-allowlisted, route-bearing layer positioned before the gate. A special
// GATE_MISSING entry is returned if the requireAuth gate is absent entirely
// (which would mean nothing is protected).
function findUnprotectedLayers(
  stack: Layer[],
  gateHandle: unknown,
  allowlist: Set<unknown>,
): number[] {
  const gateIndex = stack.findIndex((l) => l.handle === gateHandle);
  if (gateIndex === -1) return [GATE_MISSING];
  const offending: number[] = [];
  for (let i = 0; i < gateIndex; i++) {
    const layer = stack[i];
    if (layer.handle === gateHandle) continue;
    if (!layerHasRoute(layer)) continue; // plain middleware is fine
    if (allowlist.has(layer.handle)) continue; // deliberately public
    offending.push(i);
  }
  return offending;
}

// ---------------------------------------------------------------------------
// Runtime probe: defense-in-depth. Confirms the gate actually returns 401 (not
// just that it is positioned correctly) for every real endpoint.
// ---------------------------------------------------------------------------

const PUBLIC_ALLOWLIST = new Set<string>([
  "GET /api/healthz",
  // Public by design: recipients of a share link have no account.
  "GET /api/shared/1",
]);

type Endpoint = { method: string; path: string; prefixKnown: boolean };

// Walks the router stack collecting concrete endpoints. `prefixKnown` tracks
// whether we can build the exact URL: root ("/") mounts preserve it, but a
// prefixed sub-router does NOT (Express 5 hides the prefix string), so any
// endpoint under a prefixed mount is flagged. This prevents the false negative
// of probing a wrong URL and mistaking a stray 401/404 for real protection.
function collectEndpoints(
  stack: Layer[],
  prefix = "",
  prefixKnown = true,
): Endpoint[] {
  const out: Endpoint[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (method === "_all") continue;
        out.push({
          method: method.toUpperCase(),
          path: prefix + layer.route.path,
          prefixKnown,
        });
      }
      continue;
    }
    const nested = layer.handle?.stack;
    if (nested) {
      const rooted = layer.slash === true;
      out.push(...collectEndpoints(nested, prefix, prefixKnown && rooted));
    }
  }
  return out;
}

// Concrete path safe to send to supertest: params never reach a handler because
// the auth gate rejects anonymous callers first, so any placeholder works.
function concretePath(path: string): string {
  return "/api" + path.replace(/:[^/]+/g, "1");
}

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

const mountedEndpoints = collectEndpoints(stackOf(router));

describe("API auth gate", () => {
  it("leaves the health check publicly reachable", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  // ---- Structural guard (authoritative, prefix-agnostic) ----

  it("keeps the requireAuth gate mounted above every protected router", () => {
    const unprotected = findUnprotectedLayers(
      stackOf(router),
      requireAuth,
      PUBLIC_ROUTER_HANDLES,
    );
    // A non-empty result means an endpoint is reachable anonymously. This fails
    // if a new router is registered ABOVE `router.use(requireAuth)` (with OR
    // without a mount prefix), or if the gate is removed entirely.
    expect(unprotected).toEqual([]);
  });

  it("flags a router mounted above the gate — even under a prefix", () => {
    // Regression fixture: a prefixed, unauthenticated router registered above
    // the gate is exactly the mistake this task guards against. The plain-path
    // enumeration approach would probe the wrong URL and miss it; the structural
    // guard catches it by position.
    const guarded = express.Router();
    const health = express.Router();
    health.get("/healthz", (_q, res) => res.json({ status: "ok" }));
    const leak = express.Router();
    leak.get("/thing", (_q, res) => res.json({ leaked: true }));
    guarded.use(health);
    guarded.use("/public", leak); // ABOVE the gate, behind a prefix
    guarded.use(requireAuth);

    const unprotected = findUnprotectedLayers(
      stackOf(guarded),
      requireAuth,
      new Set([health]),
    );
    expect(unprotected.length).toBeGreaterThan(0);
  });

  it("accepts the same prefixed router when mounted below the gate", () => {
    const guarded = express.Router();
    const health = express.Router();
    health.get("/healthz", (_q, res) => res.json({ status: "ok" }));
    const safe = express.Router();
    safe.get("/thing", (_q, res) => res.json({ ok: true }));
    guarded.use(health);
    guarded.use(requireAuth);
    guarded.use("/public", safe); // BELOW the gate — protected

    const unprotected = findUnprotectedLayers(
      stackOf(guarded),
      requireAuth,
      new Set([health]),
    );
    expect(unprotected).toEqual([]);
  });

  it("fails loudly if the auth gate is missing entirely", () => {
    const guarded = express.Router();
    guarded.get("/thing", (_q, res) => res.json({ ok: true }));

    const unprotected = findUnprotectedLayers(
      stackOf(guarded),
      requireAuth,
      new Set(),
    );
    expect(unprotected).toContain(GATE_MISSING);
  });

  // ---- Runtime probe (defense-in-depth) ----

  it("discovers the mounted endpoints so the probe cannot silently pass", () => {
    // Guards against vacuous success if Express changes its stack shape.
    expect(mountedEndpoints.length).toBeGreaterThan(0);
    // Every real endpoint must sit at a reconstructable path; otherwise the
    // probe below cannot build an exact URL. If a prefixed mount is introduced,
    // this fails loudly (and the structural guard still enforces auth).
    expect(mountedEndpoints.filter((e) => !e.prefixKnown)).toEqual([]);
  });

  for (const { method, path } of mountedEndpoints) {
    const url = concretePath(path);
    const key = `${method} ${url}`;
    if (PUBLIC_ALLOWLIST.has(key)) continue;

    it(`rejects anonymous ${key} with 401`, async () => {
      const res = await (
        request(app) as unknown as Record<string, (p: string) => request.Test>
      )[method.toLowerCase()](url);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Unauthorized" });
    });
  }

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
