import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedRoutesTable } from "@workspace/db";
import {
  SaveRouteBody,
  GetSavedRouteResponse,
  ListSavedRoutesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getOwnerKey(req: { header(name: string): string | undefined }): string | null {
  const raw = req.header("x-owner-key");
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

router.get("/routes", async (req, res): Promise<void> => {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) {
    res.status(400).json({ message: "Missing owner key" });
    return;
  }

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

router.post("/routes", async (req, res): Promise<void> => {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) {
    res.status(400).json({ message: "Missing owner key" });
    return;
  }

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

router.get("/routes/:id", async (req, res): Promise<void> => {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) {
    res.status(400).json({ message: "Missing owner key" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(savedRoutesTable)
      .where(
        and(
          eq(savedRoutesTable.id, req.params.id),
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

router.delete("/routes/:id", async (req, res): Promise<void> => {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) {
    res.status(400).json({ message: "Missing owner key" });
    return;
  }

  try {
    const deleted = await db
      .delete(savedRoutesTable)
      .where(
        and(
          eq(savedRoutesTable.id, req.params.id),
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
