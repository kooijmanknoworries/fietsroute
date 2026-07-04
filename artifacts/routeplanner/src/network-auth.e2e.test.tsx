import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ReactNode } from "react";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";

// Regression guard for the blank-map bug (see App.tsx ApiAuthTokenBridge):
// the API server gates every endpoint behind Clerk auth, so if the web app
// ever stops attaching the session token as a bearer header, every request —
// including GET /api/network, which supplies the knooppunten — returns 401 and
// the map silently renders empty for signed-in riders.
//
// Unlike App.test.tsx (which only asserts the token *getter* is registered),
// this test exercises the real chain end-to-end inside jsdom:
//   real App wiring → real generated API client → real customFetch →
//   a real local HTTP server that rejects any request without the bearer.
// The signed-in UI must end up showing the node-count indicator, which only
// renders when /api/network actually delivered nodes. If auth wiring breaks
// and the server starts answering 401, the indicator never appears and this
// test fails loudly.
//
// jsdom has no WebGL, so the real MapLibre constructor throws; Map.tsx then
// falls back to reporting the initial viewport bbox (the same path a WebGL-less
// browser takes), which is exactly what triggers the /api/network fetch here.

const SESSION_TOKEN = "e2e-session-token";

vi.mock("@clerk/react", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignIn: () => <div data-testid="sign-in-page" />,
  SignUp: () => <div data-testid="sign-up-page" />,
  // Signed-in session: HomeGate renders the real planner.
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    when === "signed-in" ? <>{children}</> : null,
  useClerk: () => ({ addListener: () => () => {}, signOut: async () => {} }),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "user_e2e_map",
    getToken: async () => SESSION_TOKEN,
  }),
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "user_e2e_map",
      firstName: "Map",
      lastName: "Tester",
      fullName: "Map Tester",
      primaryEmailAddress: { emailAddress: "maptester@example.com" },
    },
  }),
}));

vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: () => "pk_test_fake",
}));

vi.mock("@clerk/themes", () => ({ shadcn: {} }));

// Simulate a WebGL-less browser: the MapLibre constructor throws synchronously
// (exactly what maplibre-gl does when WebGL is unavailable), which drives
// Map.tsx through its real fallback that still reports the initial bbox.
vi.mock("maplibre-gl", () => {
  class NoWebGlMap {
    constructor() {
      throw new Error("Failed to initialize WebGL");
    }
  }
  class NavigationControl {}
  class ScaleControl {}
  class Popup {}
  return {
    default: { Map: NoWebGlMap, NavigationControl, ScaleControl, Popup },
  };
});

import App from "./App";
import { setBaseUrl } from "@workspace/api-client-react";

interface SeenRequest {
  method: string;
  path: string;
  authorization: string | null;
}

const seenRequests: SeenRequest[] = [];

const NETWORK_NODES = [
  { id: "1001", ref: "34", lat: 52.09, lon: 5.12 },
  { id: "1002", ref: "35", lat: 52.1, lon: 5.13 },
  { id: "1003", ref: "36", lat: 52.11, lon: 5.14 },
];

let server: Server;
let baseUrl: string;

function json(status: number, body: unknown) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Mirrors the real API server's contract: every /api endpoint requires a
// Clerk bearer token and answers 401 without one.
function route(path: string, authorized: boolean) {
  if (!authorized) return json(401, { message: "Unauthorized" });

  if (path.startsWith("/api/network/status")) {
    return json(200, {
      ready: true,
      complete: true,
      refreshing: false,
      nodeCount: NETWORK_NODES.length,
      segmentCount: 0,
      chunkCount: 90,
      importedChunkCount: 90,
      oldestDataAt: new Date().toISOString(),
      newestDataAt: new Date().toISOString(),
      oldestDataAgeHours: 0,
    });
  }
  if (path.startsWith("/api/network")) {
    return json(200, { nodes: NETWORK_NODES, segments: [], truncated: false });
  }
  if (path.startsWith("/api/regions")) return json(200, []);
  if (path.startsWith("/api/routes")) return json(200, []);
  if (path.startsWith("/api/visited-segments")) return json(200, []);
  if (path.startsWith("/api/me/access")) {
    return json(200, { status: "approved", isOwner: false });
  }
  return json(404, { message: `Unhandled test route: ${path}` });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    const authorization = req.headers.authorization ?? null;
    seenRequests.push({ method: req.method ?? "GET", path, authorization });

    const authorized = authorization === `Bearer ${SESSION_TOKEN}`;
    const { status, headers, body } = route(path, authorized);
    res.writeHead(status, headers);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setBaseUrl(baseUrl);
});

afterAll(async () => {
  setBaseUrl(null);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  seenRequests.length = 0;
  window.history.replaceState(null, "", "/");
  // jsdom lacks matchMedia (use-mobile) and scrollIntoView (cmdk).
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
});

describe("signed-in web map network auth (blank-map regression)", () => {
  it("loads knooppunten via authenticated /api/network (200) and shows them in the UI", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // The node-count indicator renders only when the network response
    // actually delivered nodes to the planner — the observable "map is not
    // blank" signal that works without WebGL.
    const indicator = await screen.findByTestId(
      "network-node-count",
      {},
      { timeout: 10000 },
    );
    expect(indicator.textContent).toContain(String(NETWORK_NODES.length));

    // The knooppunten request itself must have succeeded with the bearer.
    const networkRequests = seenRequests.filter(
      (r) => r.path.startsWith("/api/network") && !r.path.includes("/status"),
    );
    expect(networkRequests.length).toBeGreaterThan(0);
    for (const request of networkRequests) {
      expect(request.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    }

    // Fail loudly if ANY api call went out without the session token — the
    // exact regression that blanked the map (server answers 401 to those).
    const unauthenticated = seenRequests.filter(
      (r) => r.authorization !== `Bearer ${SESSION_TOKEN}`,
    );
    expect(unauthenticated).toEqual([]);
  }, 15000);

  it("server harness sanity: /api/network without a bearer token answers 401", async () => {
    const response = await fetch(`${baseUrl}/api/network?bbox=5,52,5.3,52.2`);
    expect(response.status).toBe(401);
  });
});
