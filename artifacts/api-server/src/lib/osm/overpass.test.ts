import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { type Bbox, fetchOverpass, sweepExpiredCache } from "./overpass";

// fetchOverpass keys its in-memory L1 cache and the persistent Postgres cache by
// the bbox rounded to 3 decimals (see cacheKey). The L1 cache is module-level
// and survives across tests in this file, so each test uses a distinct bbox to
// keep its key isolated from the others. These keys are far from the 5.x,52.x
// tiles network.test.ts exercises so the two suites never shadow each other.
const HIT_BBOX: Bbox = { minLon: 9.0, minLat: 49.0, maxLon: 9.1, maxLat: 49.1 };
const HIT_KEY = "9.000,49.000,9.100,49.100";

const EXPIRED_BBOX: Bbox = {
  minLon: 9.2,
  minLat: 49.2,
  maxLon: 9.3,
  maxLat: 49.3,
};
const EXPIRED_KEY = "9.200,49.200,9.300,49.300";

const FORCE_BBOX: Bbox = { minLon: 9.4, minLat: 49.4, maxLon: 9.5, maxLat: 49.5 };
const FORCE_KEY = "9.400,49.400,9.500,49.500";

const EMPTY_BBOX: Bbox = { minLon: 9.6, minLat: 49.6, maxLon: 9.7, maxLat: 49.7 };
const EMPTY_KEY = "9.600,49.600,9.700,49.700";

// Distinct from EMPTY_BBOX: the empty-result test above leaves an empty entry
// in the module-level L1 cache for its bbox, which would shadow the persistent
// row this test seeds.
const POISONED_BBOX: Bbox = {
  minLon: 9.8,
  minLat: 49.8,
  maxLon: 9.9,
  maxLat: 49.9,
};
const POISONED_KEY = "9.800,49.800,9.900,49.900";

const TEST_CACHE_KEYS = [HIT_KEY, EXPIRED_KEY, FORCE_KEY, EMPTY_KEY, POISONED_KEY];

const EMPTY_DATA = { nodes: [], ways: [] };

// A serialized OverpassResult ({ nodes, ways }) the way writePersistentCache
// stores it. The node id here (999) never appears in the mocked upstream
// response, so a result containing it must have come from the persistent row.
const STALE_NODE_ID = 999;
const STALE_DATA = {
  nodes: [{ id: STALE_NODE_ID, lat: 49.25, lon: 9.25, rcnRef: "99" }],
  ways: [],
};

// The mocked upstream Overpass response. Its node id (1) is distinct from the
// seeded STALE_DATA so tests can tell a fresh fetch from a cache read.
const FRESH_NODE_ID = 1;
function freshElements(): unknown[] {
  return [
    { type: "node", id: FRESH_NODE_ID, lat: 49.05, lon: 9.05, tags: { rcn_ref: "1" } },
  ];
}

function mockOverpass(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ elements: freshElements() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(spy as typeof fetch);
  return spy;
}

async function clearCache(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, TEST_CACHE_KEYS));
}

async function seedPersistent(
  key: string,
  data: unknown,
  expiresAt: Date,
): Promise<void> {
  await db
    .insert(overpassCacheTable)
    .values({ key, data, expiresAt })
    .onConflictDoUpdate({
      target: overpassCacheTable.key,
      set: { data, expiresAt },
    });
}

describe("fetchOverpass caching", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCache();
  });

  afterAll(async () => {
    await clearCache();
  });

  it("serves a repeat lookup for the same bbox from cache without a second upstream fetch", async () => {
    const spy = mockOverpass();

    const first = await fetchOverpass(HIT_BBOX);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...first.nodes.keys()]).toEqual([FRESH_NODE_ID]);

    const second = await fetchOverpass(HIT_BBOX);
    // The second call must hit the cache: no additional upstream request.
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...second.nodes.keys()]).toEqual([FRESH_NODE_ID]);
  });

  it("ignores an expired persistent row and fetches fresh data", async () => {
    // Seed a persistent row whose TTL is already in the past. readPersistentCache
    // must treat it as a miss, so the mocked upstream is queried instead.
    await seedPersistent(EXPIRED_KEY, STALE_DATA, new Date(Date.now() - 1000));

    const spy = mockOverpass();
    const result = await fetchOverpass(EXPIRED_BBOX);

    expect(spy).toHaveBeenCalledTimes(1);
    // Fresh upstream node, not the stale seeded one.
    expect([...result.nodes.keys()]).toEqual([FRESH_NODE_ID]);
    expect(result.nodes.has(STALE_NODE_ID)).toBe(false);
  });

  it("bypasses the cache when forceRefresh is set", async () => {
    // Seed a still-valid persistent row. A normal call would return it without a
    // network request; forceRefresh must skip it and re-query upstream.
    await seedPersistent(
      FORCE_KEY,
      STALE_DATA,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    const spy = mockOverpass();
    const result = await fetchOverpass(FORCE_BBOX, { forceRefresh: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect([...result.nodes.keys()]).toEqual([FRESH_NODE_ID]);
    expect(result.nodes.has(STALE_NODE_ID)).toBe(false);
  });

  it("never persists an empty result to the durable cache (outage poisoning guard)", async () => {
    // An Overpass outage can yield a syntactically valid but empty response.
    // Persisting it for the full 7-day TTL would blank the map for that tile,
    // so empty results must stay in the short-lived in-memory cache only.
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(spy as typeof fetch);

    const result = await fetchOverpass(EMPTY_BBOX);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.nodes.size).toBe(0);
    expect(result.ways.length).toBe(0);

    // No persistent row may exist for this key.
    const rows = await db
      .select({ key: overpassCacheTable.key })
      .from(overpassCacheTable)
      .where(inArray(overpassCacheTable.key, [EMPTY_KEY]));
    expect(rows).toEqual([]);

    // Within the short TTL the empty result is served from the in-memory L1
    // cache, so no second upstream request is made.
    const second = await fetchOverpass(EMPTY_BBOX);
    expect(second.nodes.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores a poisoned empty persistent row and fetches fresh data", async () => {
    // Simulate a row poisoned during an Overpass outage: empty payload with a
    // still-valid TTL. The read path must treat it as a miss so the mocked
    // upstream is queried and its fresh data replaces the empty row.
    await seedPersistent(
      POISONED_KEY,
      EMPTY_DATA,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    const spy = mockOverpass();
    const result = await fetchOverpass(POISONED_BBOX);

    expect(spy).toHaveBeenCalledTimes(1);
    expect([...result.nodes.keys()]).toEqual([FRESH_NODE_ID]);

    // The fresh (non-empty) result is persisted over the poisoned row.
    const rows = await db
      .select()
      .from(overpassCacheTable)
      .where(inArray(overpassCacheTable.key, [POISONED_KEY]));
    expect(rows).toHaveLength(1);
    const stored = rows[0].data as { nodes: unknown[] };
    expect(stored.nodes.length).toBeGreaterThan(0);
  });
});

// Distinct keys from the fetchOverpass suite above (8.x/48.x vs 9.x/49.x) so the
// two suites' seeded rows never collide. sweepExpiredCache deletes by expiry, not
// by key, so the test cleans up its own rows before and after.
const SWEEP_EXPIRED_KEY_A = "8.000,48.000,8.100,48.100";
const SWEEP_EXPIRED_KEY_B = "8.200,48.200,8.300,48.300";
const SWEEP_VALID_KEY = "8.400,48.400,8.500,48.500";
const SWEEP_KEYS = [SWEEP_EXPIRED_KEY_A, SWEEP_EXPIRED_KEY_B, SWEEP_VALID_KEY];

async function clearSweepKeys(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, SWEEP_KEYS));
}

async function remainingSweepKeys(): Promise<string[]> {
  const rows = await db
    .select({ key: overpassCacheTable.key })
    .from(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, SWEEP_KEYS));
  return rows.map((r) => r.key).sort();
}

describe("sweepExpiredCache", () => {
  beforeEach(async () => {
    await clearSweepKeys();
  });

  afterEach(async () => {
    await clearSweepKeys();
  });

  afterAll(async () => {
    await clearSweepKeys();
  });

  it("removes only expired rows and reports the correct removed count", async () => {
    // Clear any expired rows that leaked from other suites so the returned count
    // reflects exactly the rows seeded here (file parallelism is disabled, so no
    // other suite races us between this sweep and the assertion).
    await sweepExpiredCache();

    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await seedPersistent(SWEEP_EXPIRED_KEY_A, STALE_DATA, past);
    await seedPersistent(SWEEP_EXPIRED_KEY_B, STALE_DATA, past);
    await seedPersistent(SWEEP_VALID_KEY, STALE_DATA, future);

    const removed = await sweepExpiredCache();

    // Exactly the two expired rows were deleted; the still-valid row survives.
    expect(removed).toBe(2);
    expect(await remainingSweepKeys()).toEqual([SWEEP_VALID_KEY]);
  });

  it("purges empty-payload rows even when they have not expired", async () => {
    await sweepExpiredCache();

    const future = new Date(Date.now() + 60 * 60 * 1000);
    await seedPersistent(SWEEP_EXPIRED_KEY_A, { nodes: [], ways: [] }, future);
    await seedPersistent(SWEEP_VALID_KEY, STALE_DATA, future);

    const removed = await sweepExpiredCache();

    expect(removed).toBe(1);
    expect(await remainingSweepKeys()).toEqual([SWEEP_VALID_KEY]);
  });

  it("removes nothing when every row is still valid", async () => {
    await sweepExpiredCache();

    const future = new Date(Date.now() + 60 * 60 * 1000);
    await seedPersistent(SWEEP_EXPIRED_KEY_A, STALE_DATA, future);
    await seedPersistent(SWEEP_VALID_KEY, STALE_DATA, future);

    const removed = await sweepExpiredCache();

    expect(removed).toBe(0);
    expect(await remainingSweepKeys()).toEqual(
      [SWEEP_EXPIRED_KEY_A, SWEEP_VALID_KEY].sort(),
    );
  });
});
