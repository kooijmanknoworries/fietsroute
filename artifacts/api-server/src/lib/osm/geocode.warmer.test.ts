import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db, geocodeCacheTable } from "@workspace/db";
import {
  COMMON_MUNICIPALITIES,
  isMunicipalityCached,
  warmMunicipalities,
} from "./geocode";

// Mirror the private normalizeMunicipalityQuery + lowercase used by the geocode
// service to derive the cache key, so seeded rows line up with the keys the
// warmer looks up. None of COMMON_MUNICIPALITIES carry a "gemeente" prefix, so
// this reduces to trim + collapse-whitespace + lowercase.
function cacheKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const ALL_KEYS = COMMON_MUNICIPALITIES.map(cacheKey);

// One municipality the warmer must actually fetch. Kept out of the seeded set so
// it is a guaranteed cache miss. Choosing a name not touched by other geocode
// tests keeps the in-memory L1 cache clean for this run.
const TARGET = "Zwolle";
const TARGET_KEY = cacheKey(TARGET);

const FAR_FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

// A minimal but valid Nominatim administrative-boundary item so a structured
// city search resolves to exactly one result (and the free-text fallback, which
// would fire a second fetch, never runs).
function nominatimAdminItem(name: string): unknown {
  return {
    osm_type: "relation",
    osm_id: 1234,
    lat: "52.5168",
    lon: "6.0830",
    name,
    display_name: `${name}, Nederland`,
    category: "boundary",
    type: "administrative",
    importance: 0.7,
    boundingbox: ["52.4", "52.6", "6.0", "6.2"],
  };
}

function mockNominatim(name: string): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify([nominatimAdminItem(name)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

async function seedCache(names: string[]): Promise<void> {
  if (names.length === 0) return;
  await db
    .insert(geocodeCacheTable)
    .values(
      names.map((name) => ({
        key: cacheKey(name),
        data: [nominatimAdminItem(name)] as unknown,
        expiresAt: FAR_FUTURE,
      })),
    )
    .onConflictDoUpdate({
      target: geocodeCacheTable.key,
      set: { expiresAt: FAR_FUTURE },
    });
}

async function clearCache(): Promise<void> {
  await db
    .delete(geocodeCacheTable)
    .where(inArray(geocodeCacheTable.key, ALL_KEYS));
}

function fetchedCities(): string[] {
  const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return spy.mock.calls.map((args: unknown[]) => {
    const url = new URL(String(args[0]));
    return url.searchParams.get("city") ?? url.searchParams.get("q") ?? "";
  });
}

describe("warmMunicipalities", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await clearCache();
  });

  // This must run before the "skips" test: isMunicipalityCached populates the
  // in-memory L1 cache as a side effect, so seeding every name there first would
  // make TARGET appear cached here and suppress the fetch we want to observe.
  it("fetches and caches municipalities that are not yet cached", async () => {
    // Seed every common name except TARGET so the warmer skips them and only
    // fetches the single missing one (keeping the throttled run fast).
    await seedCache(COMMON_MUNICIPALITIES.filter((n) => n !== TARGET));

    expect(await isMunicipalityCached(TARGET)).toBe(false);

    mockNominatim(TARGET);
    await warmMunicipalities();

    const cities = fetchedCities();
    // Only the uncached TARGET should have hit Nominatim.
    expect(cities).toEqual([TARGET]);

    // It must now be served from cache without any further network call.
    expect(await isMunicipalityCached(TARGET)).toBe(true);

    const rows = await db
      .select()
      .from(geocodeCacheTable)
      .where(inArray(geocodeCacheTable.key, [TARGET_KEY]));
    expect(rows).toHaveLength(1);
  });

  it("skips municipalities already present in the cache without calling Nominatim", async () => {
    // Every common name is cached, so the warmer must make zero network calls.
    await seedCache(COMMON_MUNICIPALITIES);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await warmMunicipalities();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
