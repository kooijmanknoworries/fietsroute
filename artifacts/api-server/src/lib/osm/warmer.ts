import { logger } from "../logger";
import {
  fetchOverpass,
  getPersistentCacheExpiry,
  getTilesForBbox,
  type Bbox,
} from "./overpass";
import { REGIONS, regionBbox } from "./regions";

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const WARM_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STARTUP_DELAY_MS = 5 * 1000;

const THROTTLE_MS = 2 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tileKey(bbox: Bbox): string {
  return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

function popularTiles(): Bbox[] {
  const byKey = new Map<string, Bbox>();
  for (const region of REGIONS) {
    for (const tile of getTilesForBbox(regionBbox(region))) {
      const key = tileKey(tile);
      if (!byKey.has(key)) byKey.set(key, tile);
    }
  }
  return [...byKey.values()];
}

let warming = false;

export async function warmRegions(): Promise<void> {
  if (warming) {
    logger.info("Cache warming already in progress, skipping this run");
    return;
  }
  warming = true;

  const tiles = popularTiles();
  const now = Date.now();
  let warmed = 0;
  let skipped = 0;
  let failed = 0;

  logger.info(
    { regions: REGIONS.length, tiles: tiles.length },
    "Starting cache warming run",
  );

  try {
    for (const tile of tiles) {
      let expiry: number | null;
      try {
        expiry = await getPersistentCacheExpiry(tile);
      } catch (err) {
        failed++;
        logger.warn(
          { err, tile: tileKey(tile) },
          "Cache expiry lookup failed, skipping tile",
        );
        continue;
      }

      if (expiry !== null && expiry - now > REFRESH_THRESHOLD_MS) {
        skipped++;
        continue;
      }

      try {
        await fetchOverpass(tile, { forceRefresh: true });
        warmed++;
        logger.info({ tile: tileKey(tile) }, "Warmed tile cache");
      } catch (err) {
        failed++;
        logger.warn(
          { err, tile: tileKey(tile) },
          "Failed to warm tile cache",
        );
      }

      await sleep(THROTTLE_MS);
    }
  } finally {
    warming = false;
  }

  logger.info({ warmed, skipped, failed }, "Cache warming run complete");
}

export function startCacheWarming(): void {
  if (process.env["DISABLE_CACHE_WARMING"] === "true") {
    logger.info("Cache warming disabled via DISABLE_CACHE_WARMING");
    return;
  }

  setTimeout(() => {
    void warmRegions();
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    void warmRegions();
  }, WARM_INTERVAL_MS).unref();
}
