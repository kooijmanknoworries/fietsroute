---
name: Geocode/persistent cache test isolation
description: Why geocode route tests must clear the persistent cache, and how warming can break them.
---

# Geocode persistent cache vs. mocked-fetch tests

`searchMunicipalities` (artifacts/api-server/src/lib/osm/geocode.ts) checks the
in-memory L1 cache, then the Postgres `geocode_cache` table, BEFORE calling
Nominatim. Tests that mock `globalThis.fetch` to assert a specific mapped result
(e.g. geocode.test.ts asserting Utrecht → relation/47811) will get a cache hit
and return real/warmed data instead, failing on id/lat/lon/boundingBox.

**Why:** the startup municipality warmer (`warmMunicipalities`) populates the
shared dev Postgres with real entries for common town names (Utrecht, etc.), and
the test DB is shared with the dev environment.

**How to apply:** any geocode test that mocks Nominatim must delete the
`geocode_cache` rows for the keys it exercises in both beforeEach and afterEach
(keys are the normalized, lowercased query). Don't rely on an empty cache.
