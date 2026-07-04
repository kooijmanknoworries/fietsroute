import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutePlan, RouteRequestNode } from "@workspace/api-client-react";

// In-memory stand-in for AsyncStorage so the on-device backup store can be
// exercised under jsdom without a native module.
const store = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

import {
  deleteLocalRoute,
  getLocalRoute,
  listLocalRoutes,
  saveLocalRoute,
} from "./localRoutes";

const NODES: RouteRequestNode[] = [
  { id: "1", ref: "63", lat: 52.0, lon: 5.0 },
  { id: "2", ref: "08", lat: 52.01, lon: 5.01 },
];

const PLAN: RoutePlan = {
  nodeRefs: ["63", "08"],
  coordinates: [
    [5.0, 52.0],
    [5.01, 52.01],
  ],
  distanceMeters: 4200,
  legs: [
    {
      fromRef: "63",
      toRef: "08",
      distanceMeters: 4200,
      coordinates: [
        [5.0, 52.0],
        [5.01, 52.01],
      ],
    },
  ],
} as unknown as RoutePlan;

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("localRoutes backup store", () => {
  it("returns an empty list when nothing has been saved", async () => {
    expect(await listLocalRoutes()).toEqual([]);
  });

  it("saving a route creates a retrievable on-device backup", async () => {
    const saved = await saveLocalRoute({ name: "Rondje Veluwe", nodes: NODES, plan: PLAN });

    expect(saved.id).toMatch(/^bk_/);
    expect(saved.name).toBe("Rondje Veluwe");
    expect(saved.createdAt).toBeTruthy();
    // Nodes + geometry are persisted intact so reopening can restore them.
    expect(saved.nodes).toEqual(NODES);
    expect(saved.plan).toEqual(PLAN);

    const list = await listLocalRoutes();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(saved);

    const fetched = await getLocalRoute(saved.id);
    expect(fetched).toEqual(saved);
  });

  it("stores newest routes first", async () => {
    const first = await saveLocalRoute({ name: "Eerste", nodes: NODES, plan: PLAN });
    const second = await saveLocalRoute({ name: "Tweede", nodes: NODES, plan: PLAN });

    const list = await listLocalRoutes();
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("returns null for an unknown backup id", async () => {
    await saveLocalRoute({ name: "Rondje", nodes: NODES, plan: PLAN });
    expect(await getLocalRoute("bk_nope")).toBeNull();
  });

  it("deletes a backup by id and leaves the rest intact", async () => {
    const a = await saveLocalRoute({ name: "A", nodes: NODES, plan: PLAN });
    const b = await saveLocalRoute({ name: "B", nodes: NODES, plan: PLAN });

    await deleteLocalRoute(a.id);

    const list = await listLocalRoutes();
    expect(list.map((r) => r.id)).toEqual([b.id]);
    expect(await getLocalRoute(a.id)).toBeNull();
  });

  it("survives corrupt storage without throwing", async () => {
    store.set("fietsrouteplanner.localRoutes.v1", "{not json");
    expect(await listLocalRoutes()).toEqual([]);
    // A save after corruption still works (overwrites the bad value).
    const saved = await saveLocalRoute({ name: "Herstel", nodes: NODES, plan: PLAN });
    expect(await listLocalRoutes()).toEqual([saved]);
  });
});
