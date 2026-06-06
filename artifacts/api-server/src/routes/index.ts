import { Router, type IRouter } from "express";
import healthRouter from "./health";
import networkRouter from "./network";
import routeRouter from "./route";
import regionsRouter from "./regions";
import geocodeRouter from "./geocode";
import savedRoutesRouter from "./saved-routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(networkRouter);
router.use(routeRouter);
router.use(regionsRouter);
router.use(geocodeRouter);
router.use(savedRoutesRouter);

export default router;
