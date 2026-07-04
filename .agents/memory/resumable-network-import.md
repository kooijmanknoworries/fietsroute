---
name: Resumable network dataset import
description: How the NL/BE knooppunten import resumes and self-heals
---

The full NL/BE rcn import is chunked (~90 chunks) and resumable:
- Each successful chunk is marked in `overpass_cache` under `import-chunk:<minLat>,<minLon>` keys (7-day TTL); a re-run skips fresh chunks, so workflow restarts mid-import are cheap.
- Global segment prune runs only when `failed === 0 && skipped === 0` to avoid deleting data on partial runs.
- Safety net: if all chunks were skipped but the dataset is still incomplete, markers are cleared to force a real re-fetch.
- Self-heal: the 10-min retry loop triggers a full re-import when the dataset is incomplete even if no failed chunks are recorded (previously waited up to 24h).

**How to apply:** if the dataset looks degraded, check chunk markers in `overpass_cache` before assuming Overpass problems; deleting `import-chunk:` rows forces re-import of those chunks.
