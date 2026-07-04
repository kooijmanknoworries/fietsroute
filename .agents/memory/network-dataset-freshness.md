---
name: Network dataset freshness policy
description: How the preloaded NL/BE node network is kept current and how to observe its age
---

The preloaded knooppunten dataset is kept fresh by a **rolling refresh** plus an
observable status field, layered on top of the existing full-import + failed-chunk
retry loops.

- Rolling refresh re-imports the *single oldest chunk* on a timer whose cadence is
  derived from the grid size and the stale window (`interval ≈ STALE_MS / CHUNK_COUNT`,
  with a floor). Over a full window every chunk gets refreshed without a heavy
  all-at-once re-import, and it only ever runs one small Overpass query at a time
  (shares the single serialized slot), so it never blocks live traffic.
- It skips while a full import is running and while the dataset is incomplete —
  the full import + retry loops own the "get it whole" phase; rolling refresh owns
  the "keep it fresh" phase.

**Chunk markers are a freshness signal, not an existence signal.** The
`import-chunk:` markers in `overpass_cache` can be entirely absent (expired/swept)
while the dataset tables still hold the full ~25k nodes. Observed live:
`importedChunkCount: 0` with a complete dataset. That is expected — a marker-less
chunk is treated as maximally old, so rolling refresh re-imports it next and
repopulates its marker. Don't read "0 markers" as "dataset gone".

**Observability:** `GET /api/network/status` (and a "Network dataset status" log
line after each import/refresh) reports nodeCount, segmentCount, chunkCount,
importedChunkCount, oldest/newest data timestamps, and `oldestDataAgeHours` — the
worst-case staleness anywhere in the dataset. `getDatasetStatus()` in dataset.ts
is the single source; the route just validates + serializes it.

**Why:** Previously a fully loaded dataset only refreshed when the freshest row
aged past the stale window (a weekly all-at-once re-import), and there was no way
to see how old the data was. Rolling refresh smooths that out and the status field
makes drift visible.
