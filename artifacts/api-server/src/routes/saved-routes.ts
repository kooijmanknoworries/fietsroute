import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, savedRoutesTable } from "@workspace/db";
import {
  SaveRouteBody,
  UpdateSavedRouteBody,
  GetSavedRouteResponse,
  ListSavedRoutesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Scopes saved routes to the authenticated Clerk user so they follow the user
// across browsers and devices. The user id is stored in the existing
// `owner_key` column.
const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req)?.userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};

router.get("/routes", requireAuth, async (req, res): Promise<void> => {
  const ownerKey = getAuth(req).userId!;

  try {
    const rows = await db
      .select()
      .from(savedRoutesTable)
      .where(eq(savedRoutesTable.ownerKey, ownerKey))
      .orderBy(desc(savedRoutesTable.createdAt));

    const summaries = rows.map((row) => {
      const plan = row.plan as { distanceMeters: number; nodeRefs: string[] };
      return {
        id: row.id,
        name: row.name,
        distanceMeters: plan.distanceMeters,
        nodeRefs: plan.nodeRefs,
        createdAt: row.createdAt,
      };
    });

    res.json(ListSavedRoutesResponse.parse(summaries));
  } catch (err) {
    req.log.error({ err }, "Failed to list saved routes");
    res.status(502).json({ message: "Failed to list saved routes" });
  }
});

router.post("/routes", requireAuth, async (req, res): Promise<void> => {
  const ownerKey = getAuth(req).userId!;

  const parsed = SaveRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body" });
    return;
  }

  const name = parsed.data.name.trim();
  if (name === "") {
    res.status(400).json({ message: "Route name is required" });
    return;
  }

  try {
    const [row] = await db
      .insert(savedRoutesTable)
      .values({
        ownerKey,
        name,
        nodes: parsed.data.nodes,
        plan: parsed.data.plan,
      })
      .returning();

    res.status(201).json(
      GetSavedRouteResponse.parse({
        id: row.id,
        name: row.name,
        nodes: row.nodes,
        plan: row.plan,
        createdAt: row.createdAt,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to save route");
    res.status(502).json({ message: "Failed to save route" });
  }
});

router.get("/routes/:id", requireAuth, async (req, res): Promise<void> => {
  const ownerKey = getAuth(req).userId!;
  const routeId = String(req.params.id);

  try {
    const [row] = await db
      .select()
      .from(savedRoutesTable)
      .where(
        and(
          eq(savedRoutesTable.id, routeId),
          eq(savedRoutesTable.ownerKey, ownerKey),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ message: "Route not found" });
      return;
    }

    res.json(
      GetSavedRouteResponse.parse({
        id: row.id,
        name: row.name,
        nodes: row.nodes,
        plan: row.plan,
        createdAt: row.createdAt,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch saved route");
    res.status(502).json({ message: "Failed to fetch saved route" });
  }
});

router.patch("/routes/:id", requireAuth, async (req, res): Promise<void> => {
  const ownerKey = getAuth(req).userId!;
  const routeId = String(req.params.id);

  const parsed = UpdateSavedRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body" });
    return;
  }

  const name = parsed.data.name.trim();
  if (name === "") {
    res.status(400).json({ message: "Route name is required" });
    return;
  }

  try {
    const [row] = await db
      .update(savedRoutesTable)
      .set({ name })
      .where(
        and(
          eq(savedRoutesTable.id, routeId),
          eq(savedRoutesTable.ownerKey, ownerKey),
        ),
      )
      .returning();

    if (!row) {
      res.status(404).json({ message: "Route not found" });
      return;
    }

    res.json(
      GetSavedRouteResponse.parse({
        id: row.id,
        name: row.name,
        nodes: row.nodes,
        plan: row.plan,
        createdAt: row.createdAt,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to update saved route");
    res.status(502).json({ message: "Failed to update saved route" });
  }
});

router.delete("/routes/:id", requireAuth, async (req, res): Promise<void> => {
  const ownerKey = getAuth(req).userId!;
  const routeId = String(req.params.id);

  try {
    const deleted = await db
      .delete(savedRoutesTable)
      .where(
        and(
          eq(savedRoutesTable.id, routeId),
          eq(savedRoutesTable.ownerKey, ownerKey),
        ),
      )
      .returning({ id: savedRoutesTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ message: "Route not found" });
      return;
    }

    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete saved route");
    res.status(502).json({ message: "Failed to delete saved route" });
  }
});

export default router;
