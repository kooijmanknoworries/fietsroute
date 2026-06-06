import { Router, type IRouter } from "express";
import { GeocodeMunicipalityQueryParams, GeocodeMunicipalityResponse } from "@workspace/api-zod";
import { searchMunicipalities } from "../lib/osm/geocode";

const router: IRouter = Router();

router.get("/geocode", async (req, res): Promise<void> => {
  // Explicit presence check: the generated schema coerces `q`, so a missing
  // value would otherwise become the literal string "undefined".
  if (typeof req.query.q !== "string") {
    res.status(400).json({ message: "Query parameter 'q' is required" });
    return;
  }

  const parsed = GeocodeMunicipalityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query parameters" });
    return;
  }

  const q = parsed.data.q.trim();
  if (q.length < 2) {
    res.status(400).json({ message: "Search query must be at least 2 characters" });
    return;
  }

  try {
    const results = await searchMunicipalities(q);
    res.json(GeocodeMunicipalityResponse.parse(results));
  } catch (err) {
    req.log.error({ err }, "Failed to search municipalities");
    res.status(502).json({ message: "Failed to search municipalities" });
  }
});

export default router;
