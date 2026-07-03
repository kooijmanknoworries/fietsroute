import { Router, type IRouter } from "express";
import healthRouter from "./health";
import networkRouter from "./network";
import lfRoutesRouter from "./lf-routes";
import routeRouter from "./route";
import regionsRouter from "./regions";
import geocodeRouter from "./geocode";
import savedRoutesRouter from "./saved-routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(networkRouter);
router.use(lfRoutesRouter);
router.use(routeRouter);
router.use(regionsRouter);
router.use(geocodeRouter);
router.use(savedRoutesRouter);

export default router;
