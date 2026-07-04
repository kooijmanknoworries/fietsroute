import { Router, type IRouter, type RequestHandler } from "express";
import { desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, userAccessTable } from "@workspace/db";
import {
  GetMyAccessResponse,
  ListUserAccessResponse,
  SetUserAccessBody,
  SetUserAccessResponse,
} from "@workspace/api-zod";
import {
  ensureUserAccess,
  isOwnerEmail,
  requireOwner,
} from "../lib/access";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req)?.userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};

// The client calls this after sign-in to learn whether it should show the
// waiting-for-approval notice and enable/disable Save route / Start ride.
router.get("/me/access", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;

  try {
    const access = await ensureUserAccess(userId);
    res.json(
      GetMyAccessResponse.parse({
        status: access.status,
        isOwner: isOwnerEmail(access.email),
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to load access status");
    res.status(502).json({ message: "Failed to load access status" });
  }
});

// Owner-only: the approval queue. Lists every known user with their status.
router.get(
  "/admin/users",
  requireOwner,
  async (req, res): Promise<void> => {
    try {
      const rows = await db
        .select()
        .from(userAccessTable)
        .orderBy(desc(userAccessTable.createdAt));

      res.json(
        ListUserAccessResponse.parse(
          rows.map((row) => ({
            userId: row.userId,
            email: row.email,
            status: row.status,
            createdAt: row.createdAt,
          })),
        ),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to list users");
      res.status(502).json({ message: "Failed to list users" });
    }
  },
);

// Owner-only: approve / reject / remove a user by setting their status.
router.patch(
  "/admin/users/:id",
  requireOwner,
  async (req, res): Promise<void> => {
    const targetId = String(req.params.id);

    const parsed = SetUserAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    try {
      const [row] = await db
        .update(userAccessTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(userAccessTable.userId, targetId))
        .returning();

      if (!row) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.json(
        SetUserAccessResponse.parse({
          userId: row.userId,
          email: row.email,
          status: row.status,
          createdAt: row.createdAt,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to update user access");
      res.status(502).json({ message: "Failed to update user access" });
    }
  },
);

export default router;
