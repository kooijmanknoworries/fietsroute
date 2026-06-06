import { Router, type IRouter } from "express";
import { GetRegionsResponse } from "@workspace/api-zod";
import { REGIONS } from "../lib/osm/regions";

const router: IRouter = Router();

router.get("/regions", (_req, res): void => {
  res.json(GetRegionsResponse.parse(REGIONS));
});

export default router;
