---
name: New-user approval gate
description: How the approval/access gate is enforced and how it constrains route tests
---

# New-user approval gate

New Clerk sign-ins get a `user_access` row (`pending` by default). Reads stay
open; only **writes** are gated by `requireApproved` (403): saved-routes
POST/PATCH/DELETE + `/routes/claim`, and visited-segments POST. Owner-only admin
endpoints (`/admin/users`, `/admin/users/:id`) use `requireOwner`.

**Why owner is by email, fetched server-side:** the owner is a fixed email
(`nicokooijman@gmail.com`), and the user's email is read from Clerk server-side
(`clerkClient.users.getUser`) — never trusted from the client — so access level
can't be spoofed. `ensureUserAccess` creates the row on first authenticated
request (owner→approved, else pending) with an insert-conflict fallback for
concurrent first hits.

**How to apply (tests):** any api-server route test that exercises a *write*
endpoint must now mock `@clerk/express`'s `clerkClient.users.getUser` (not just
`getAuth`) — returning the owner email auto-approves the test user so writes
reach 200/201. Otherwise the gate returns 403. Also clean up `user_access` rows
in `afterAll` (the gate inserts a row per distinct test user id).
