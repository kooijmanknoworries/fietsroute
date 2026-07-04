import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  RouteRequestNode,
  RoutePlan,
} from "@workspace/api-client-react";

// On-device backup of a planned route. Mirrors the server `SavedRoute` shape so
// the same UI can render both. Backups live only on this phone (no sign-in
// required) and survive offline use; server routes sync across devices.
export interface LocalRoute {
  id: string;
  name: string;
  nodes: RouteRequestNode[];
  plan: RoutePlan;
  createdAt: string;
}

const STORAGE_KEY = "fietsrouteplanner.localRoutes.v1";

function makeId(): string {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listLocalRoutes(): Promise<LocalRoute[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LocalRoute[];
  } catch {
    return [];
  }
}

async function writeAll(routes: LocalRoute[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

export async function saveLocalRoute(input: {
  name: string;
  nodes: RouteRequestNode[];
  plan: RoutePlan;
}): Promise<LocalRoute> {
  const route: LocalRoute = {
    id: makeId(),
    name: input.name,
    nodes: input.nodes,
    plan: input.plan,
    createdAt: new Date().toISOString(),
  };
  const existing = await listLocalRoutes();
  // Newest first, matching the server ordering.
  await writeAll([route, ...existing]);
  return route;
}

export async function getLocalRoute(id: string): Promise<LocalRoute | null> {
  const all = await listLocalRoutes();
  return all.find((r) => r.id === id) ?? null;
}

export async function deleteLocalRoute(id: string): Promise<void> {
  const all = await listLocalRoutes();
  await writeAll(all.filter((r) => r.id !== id));
}
