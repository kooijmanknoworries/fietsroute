import { Router, type IRouter } from "express";
import { GetLfRoutesQueryParams, GetLfRoutesResponse } from "@workspace/api-zod";
import { getLfRoutesData } from "../lib/osm/lf-routes";
import type { Bbox } from "../lib/osm/overpass";

const router: IRouter = Router();

function parseBbox(raw: string): Bbox | null {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  if (
    minLat < -90 ||
    maxLat > 90 ||
    minLon < -180 ||
    maxLon > 180
  ) {
    return null;
  }
  return { minLon, minLat, maxLon, maxLat };
}

router.get("/lf-routes", async (req, res): Promise<void> => {
  const parsed = GetLfRoutesQueryParams.safeParse(req.query);
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

  try {
    const data = await getLfRoutesData(bbox);
    res.json(GetLfRoutesResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch LF routes");
    res.status(502).json({ message: "Failed to fetch LF routes data" });
  }
});

export default router;
