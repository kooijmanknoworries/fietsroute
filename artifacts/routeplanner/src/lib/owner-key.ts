const STORAGE_KEY = "fietsrouteplanner.ownerKey";

function generateKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns a stable per-browser owner key, generating and persisting one in
 * localStorage on first use. Used to scope saved routes to this browser.
 */
export function getOrCreateOwnerKey(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim() !== "") {
      return existing;
    }
    const created = generateKey();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return generateKey();
  }
}
