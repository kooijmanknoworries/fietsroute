import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import * as Haptics from "expo-haptics";
import { planRoute } from "@workspace/api-client-react";

export interface NetworkNode {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

export interface RoutePlan {
  nodeRefs: string[];
  coordinates: number[][];
  distanceMeters: number;
  legs: Array<{
    fromRef: string;
    toRef: string;
    distanceMeters: number;
    coordinates: number[][];
  }>;
}

interface RoutePlannerState {
  selectedNodes: NetworkNode[];
  routePlan: RoutePlan | null;
  isPlanning: boolean;
  planError: string | null;
  addNode: (node: NetworkNode) => void;
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
        addNode,
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
