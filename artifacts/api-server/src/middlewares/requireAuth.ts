import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

// Rejects any request that does not carry a valid authenticated Clerk session.
// Applied as a global gate to every API endpoint except the explicitly
// allowlisted public ones (see routes/index.ts), so anonymous callers cannot
// reach route planning, network/GPS data, or per-user saved data by hitting the
// API directly — the web and mobile UIs are already gated behind login.
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req)?.userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};
