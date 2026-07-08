import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import * as Haptics from "expo-haptics";
import { planRoute } from "@workspace/api-client-react";

export interface NetworkNode {
  id: string;
  ref: string;
  lat: number;
  lon: number;
  /** "node" (default) = numbered knooppunt; "free" = arbitrary offgrid point. */
  kind?: "node" | "free";
}

export type PlanMode = "network" | "offgrid";

export interface RoutePlan {
  nodeRefs: string[];
  coordinates: number[][];
  distanceMeters: number;
  legs: Array<{
    fromRef: string;
    toRef: string;
    distanceMeters: number;
    coordinates: number[][];
    mode?: "network" | "offgrid";
  }>;
}

interface RoutePlannerState {
  selectedNodes: NetworkNode[];
  routePlan: RoutePlan | null;
  isPlanning: boolean;
  planError: string | null;
  planMode: PlanMode;
  setPlanMode: (mode: PlanMode) => void;
  addNode: (node: NetworkNode) => void;
  addFreePoint: (lat: number, lon: number) => void;
  removeNode: (nodeId: string) => void;
  clearRoute: () => void;
  undoLastNode: () => void;
  loadPlan: (nodes: NetworkNode[], plan: RoutePlan) => void;
}

const RoutePlannerContext = createContext<RoutePlannerState | null>(null);

export function RoutePlannerProvider({ children }: { children: React.ReactNode }) {
  const [selectedNodes, setSelectedNodes] = useState<NetworkNode[]>([]);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<PlanMode>("network");

  // Generation counter — increments on every intent change so stale
  // responses from older in-flight requests are silently dropped.
  const generationRef = useRef(0);

  const planRouteForNodes = useCallback(async (nodes: NetworkNode[]) => {
    // Always bump generation first so any prior in-flight request is discarded,
    // regardless of whether the new node count is sufficient to plan a route.
    generationRef.current += 1;
    const myGeneration = generationRef.current;

    if (nodes.length < 2) {
      setRoutePlan(null);
      setPlanError(null);
      setIsPlanning(false);
      return;
    }

    setIsPlanning(true);
    setPlanError(null);

    try {
      const result = await planRoute({
        nodes: nodes.map((n) => ({
          id: n.id,
          ref: n.ref,
          lat: n.lat,
          lon: n.lon,
          ...(n.kind ? { kind: n.kind } : {}),
        })),
      });

      // Only apply if we're still the latest request
      if (myGeneration === generationRef.current) {
        setRoutePlan(result as RoutePlan);
        setIsPlanning(false);
      }
    } catch (_err) {
      if (myGeneration === generationRef.current) {
        setPlanError("Kan route niet berekenen");
        setRoutePlan(null);
        setIsPlanning(false);
      }
    }
  }, []);

  const addNode = useCallback(
    (node: NetworkNode) => {
      setSelectedNodes((prev) => {
        if (prev.some((n) => n.id === node.id)) return prev;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const next = [...prev, node];
        planRouteForNodes(next);
        return next;
      });
    },
    [planRouteForNodes]
  );

  // Offgrid mode: add an arbitrary map point as a free waypoint, routed over
  // all cycle-friendly ways instead of the node network.
  const addFreePoint = useCallback(
    (lat: number, lon: number) => {
      const node: NetworkNode = {
        id: `free-${Date.now()}-${Math.round(lon * 1e5)}-${Math.round(lat * 1e5)}`,
        ref: "",
        lat,
        lon,
        kind: "free",
      };
      setSelectedNodes((prev) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const next = [...prev, node];
        planRouteForNodes(next);
        return next;
      });
    },
    [planRouteForNodes]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setSelectedNodes((prev) => {
        const next = prev.filter((n) => n.id !== nodeId);
        planRouteForNodes(next);
        return next;
      });
    },
    [planRouteForNodes]
  );

  const undoLastNode = useCallback(() => {
    setSelectedNodes((prev) => {
      if (prev.length === 0) return prev;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const next = prev.slice(0, -1);
      planRouteForNodes(next);
      return next;
    });
  }, [planRouteForNodes]);

  const clearRoute = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Bump generation so any in-flight request is discarded
    generationRef.current += 1;
    setSelectedNodes([]);
    setRoutePlan(null);
    setPlanError(null);
    setIsPlanning(false);
  }, []);

  // Restore a previously saved route: adopt its nodes and precomputed plan
  // without re-planning. Bumps the generation so any in-flight request from the
  // prior editing session is discarded.
  const loadPlan = useCallback((nodes: NetworkNode[], plan: RoutePlan) => {
    generationRef.current += 1;
    setSelectedNodes(nodes);
    setRoutePlan(plan);
    setPlanError(null);
    setIsPlanning(false);
  }, []);

  return (
    <RoutePlannerContext.Provider
      value={{
        selectedNodes,
        routePlan,
        isPlanning,
        planError,
        planMode,
        setPlanMode,
        addNode,
        addFreePoint,
        removeNode,
        clearRoute,
        undoLastNode,
        loadPlan,
      }}
    >
      {children}
    </RoutePlannerContext.Provider>
  );
}

export function useRoutePlanner() {
  const ctx = useContext(RoutePlannerContext);
  if (!ctx) throw new Error("useRoutePlanner must be used inside RoutePlannerProvider");
  return ctx;
}
