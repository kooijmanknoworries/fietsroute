import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, sharedRoutesTable } from "@workspace/db";
import { ShareRouteBody, GetSharedRouteResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireApproved } from "../lib/access";

// Shared routes are immutable public snapshots of a planned route, addressed
// by an unguessable random token. Creating a share requires an authenticated,
// approved user; reading one is public (mounted above the global requireAuth
// in routes/index.ts) so recipients can open the link without an account.

export const publicSharedRoutesRouter: IRouter = Router();

publicSharedRoutesRouter.get(
  "/shared/:token",
  async (req, res): Promise<void> => {
    const token = String(req.params.token);

    try {
      const [row] = await db
        .select()
        .from(sharedRoutesTable)
        .where(eq(sharedRoutesTable.token, token))
        .limit(1);

      if (!row) {
        res.status(404).json({ message: "Shared route not found" });
        return;
      }

      res.json(
        GetSharedRouteResponse.parse({
          name: row.name ?? undefined,
          nodes: row.nodes,
          plan: row.plan,
          createdAt: row.createdAt,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to fetch shared route");
      res.status(502).json({ message: "Failed to fetch shared route" });
    }
  },
);

const router: IRouter = Router();

router.post(
  "/shared-routes",
  requireAuth,
  requireApproved,
  async (req, res): Promise<void> => {
    const ownerKey = getAuth(req).userId!;

    const parsed = ShareRouteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    if (parsed.data.nodes.length < 2) {
      res.status(400).json({ message: "A shared route needs at least 2 nodes" });
      return;
    }

    const token = randomBytes(16).toString("base64url");

    try {
      await db.insert(sharedRoutesTable).values({
        token,
        ownerKey,
        name: parsed.data.name?.trim() || null,
        nodes: parsed.data.nodes,
        plan: parsed.data.plan,
      });

      res.status(201).json({ token });
    } catch (err) {
      req.log.error({ err }, "Failed to create shared route");
      res.status(502).json({ message: "Failed to create shared route" });
    }
  },
);

export default router;
