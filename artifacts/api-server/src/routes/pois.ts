import { Router, type IRouter } from "express";
import { GetPoisQueryParams, GetPoisResponse } from "@workspace/api-zod";
import { getPois, isPoiCategory, type PoiCategory } from "../lib/osm/pois";
import type { Bbox } from "../lib/osm/overpass";

const router: IRouter = Router();

function parseBbox(raw: string): Bbox | null {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180) {
    return null;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function parseCategories(raw: string): PoiCategory[] | null {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const categories: PoiCategory[] = [];
  for (const part of parts) {
    if (!isPoiCategory(part)) return null;
    categories.push(part);
  }
  return categories;
}

router.get("/pois", async (req, res): Promise<void> => {
  const parsed = GetPoisQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query parameters" });
    return;
  }

  const bbox = parseBbox(parsed.data.bbox);
  if (!bbox) {
    res.status(400).json({
      message: "bbox must be minLon,minLat,maxLon,maxLat with min < max",
    });
    return;
  }

  const categories = parseCategories(parsed.data.categories);
  if (!categories) {
    res.status(400).json({
      message:
        "categories must be a comma-separated list of: cafe, bike_shop, sights, ferry, toilets",
    });
    return;
  }

  try {
    const data = await getPois(bbox, categories);
    res.json(GetPoisResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch POIs");
    res.status(502).json({ message: "Failed to fetch points of interest" });
  }
});

export default router;
