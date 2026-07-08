import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import networkRouter from "./network";
import routeRouter from "./route";
import regionsRouter from "./regions";
import geocodeRouter from "./geocode";
import savedRoutesRouter from "./saved-routes";
import visitedSegmentsRouter from "./visited-segments";
import accessRouter from "./access";

const router: IRouter = Router();

// Public endpoints (allowlist). The health check must stay reachable without
// auth for deployment/monitoring probes.
router.use(healthRouter);

// Everything below requires an authenticated Clerk session. Anonymous callers
// are rejected with 401 so they cannot bypass the UI login gate by hitting the
// API directly. Add new public endpoints ABOVE this line and gate everything
// else by default.
router.use(requireAuth);

router.use(networkRouter);
router.use(routeRouter);
router.use(regionsRouter);
router.use(geocodeRouter);
router.use(accessRouter);
router.use(savedRoutesRouter);
router.use(visitedSegmentsRouter);

export default router;
