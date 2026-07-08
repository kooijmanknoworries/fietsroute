import { Router, type IRouter } from "express";
import {
  PlanRouteBody,
  PlanRouteResponse,
  GetElevationProfileBody,
  GetElevationProfileResponse,
} from "@workspace/api-zod";
import { planRoute, NoPathError, RouteRequestError } from "../lib/osm/routing";
import {
  getElevationProfile,
  ElevationRequestError,
  ElevationUpstreamError,
} from "../lib/elevation";

const router: IRouter = Router();

router.post("/route", async (req, res): Promise<void> => {
  const parsed = PlanRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body" });
    return;
  }

  if (parsed.data.nodes.length < 2) {
    res.status(400).json({ message: "Select at least two nodes to plan a route" });
    return;
  }

  try {
    const plan = await planRoute(parsed.data.nodes);
    res.json(PlanRouteResponse.parse(plan));
  } catch (err) {
    if (err instanceof RouteRequestError) {
      res.status(400).json({ message: err.message });
      return;
    }
    if (err instanceof NoPathError) {
      res.status(422).json({ message: err.message });
      return;
    }
    req.log.error({ err }, "Failed to plan route");
    res.status(502).json({ message: "Failed to plan route" });
  }
});

router.post("/route/elevation", async (req, res): Promise<void> => {
  const parsed = GetElevationProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body" });
    return;
  }

  try {
    const profile = await getElevationProfile(parsed.data.coordinates);
    res.json(GetElevationProfileResponse.parse(profile));
  } catch (err) {
    if (err instanceof ElevationRequestError) {
      res.status(400).json({ message: err.message });
      return;
    }
    if (err instanceof ElevationUpstreamError) {
      res.status(502).json({ message: err.message });
      return;
    }
    req.log.error({ err }, "Failed to compute elevation profile");
    res.status(502).json({ message: "Failed to compute elevation profile" });
  }
});

export default router;
