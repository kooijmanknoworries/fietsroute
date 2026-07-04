import type { RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, userAccessTable, type UserAccessRow } from "@workspace/db";

// The fixed owner (admin). This account is always auto-approved on first sign-in
// and is the only account allowed to use the admin approval-queue endpoints.
export const OWNER_EMAIL = "nicokooijman@gmail.com";

export type AccessStatus = "pending" | "approved" | "rejected";

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}

// Reads the user's primary email from Clerk server-side, so the client cannot
// spoof which email (and therefore which access level) it maps to. Returns null
// when Clerk is unreachable or the user has no email on file.
async function fetchClerkEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const primaryId = user.primaryEmailAddressId;
    const primary = user.emailAddresses.find((e) => e.id === primaryId);
    return (
      primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null
    );
  } catch {
    return null;
  }
}

// Returns the access record for a Clerk user, creating it on first sight. The
// owner email is stored as `approved`; everyone else starts as `pending`.
// Concurrent first requests are made safe by an insert conflict fallback.
export async function ensureUserAccess(
  userId: string,
): Promise<UserAccessRow> {
  const [existing] = await db
    .select()
    .from(userAccessTable)
    .where(eq(userAccessTable.userId, userId))
    .limit(1);
  if (existing) return existing;

  const email = await fetchClerkEmail(userId);
  const status: AccessStatus = isOwnerEmail(email) ? "approved" : "pending";

  const [inserted] = await db
    .insert(userAccessTable)
    .values({ userId, email, status })
    .onConflictDoNothing({ target: userAccessTable.userId })
    .returning();
  if (inserted) return inserted;

  // Another request created the row first — read it back.
  const [row] = await db
    .select()
    .from(userAccessTable)
    .where(eq(userAccessTable.userId, userId))
    .limit(1);
  return row;
}

// Gate for data-changing endpoints: only `approved` users pass. Pending or
// rejected users get a clear 403 so the gate can't be bypassed from the client.
export const requireApproved: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req)?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const access = await ensureUserAccess(userId);
    if (access?.status !== "approved") {
      res
        .status(403)
        .json({ message: "Your account is waiting for approval" });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Failed to verify account access");
    res.status(502).json({ message: "Failed to verify account access" });
  }
};

// Gate for owner-only admin endpoints. Verifies the caller is the fixed owner
// by the email stored on their access record (which was read from Clerk).
export const requireOwner: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req)?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const access = await ensureUserAccess(userId);
    if (!isOwnerEmail(access?.email)) {
      res.status(403).json({ message: "Owner access required" });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Failed to verify owner access");
    res.status(502).json({ message: "Failed to verify owner access" });
  }
};
