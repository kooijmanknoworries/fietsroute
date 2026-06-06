---
name: Saved routes ownership model
description: How saved routes are scoped to a user without real authentication
---
Saved routes are scoped per-browser via an anonymous owner key, not real auth.

- The web client generates a UUID once, stores it in localStorage, and registers it through `setOwnerKey` in the api-client; every request then carries an `x-owner-key` header.
- The API server reads `x-owner-key`, requires it (400 if missing), and filters/owns all saved-route rows by that key.

**Why:** The task allowed "likely auth" but forcing a login UI on a public route planner is heavy; an anonymous per-browser key satisfies "persist across sessions" with far less friction.

**How to apply:** If real user accounts are added later (or for the mobile artifact), replace/augment the owner key with the authenticated user id on the server side — the per-row ownership column already exists, so only the key source changes. Clearing browser storage loses access to previously saved routes; that's an accepted limitation of this model.
