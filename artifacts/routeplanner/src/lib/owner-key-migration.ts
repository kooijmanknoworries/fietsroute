// Before sign-in existed, the web client scoped saved routes to a per-browser
// anonymous UUID stored under this localStorage key. After moving to Clerk auth
// the key is no longer used, but it may still linger in returning users'
// browsers — it lets us reclaim the routes they saved anonymously.
const LEGACY_OWNER_KEY = "fietsrouteplanner.ownerKey";

export function getLegacyOwnerKey(): string | null {
  try {
    const value = localStorage.getItem(LEGACY_OWNER_KEY);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

export function clearLegacyOwnerKey(): void {
  try {
    localStorage.removeItem(LEGACY_OWNER_KEY);
  } catch {
    // ignore (e.g. storage disabled)
  }
}
