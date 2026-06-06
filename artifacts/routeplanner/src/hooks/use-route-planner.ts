import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useDebounce } from "use-debounce";
import { 
  useGetNetwork, 
  usePlanRoute, 
  useGetRegions,
  useListSavedRoutes,
  useSaveRoute,
  useDeleteSavedRoute,
  useUpdateSavedRoute,
  getSavedRoute,
  getNetwork,
  getListSavedRoutesQueryKey,
  getGetNetworkQueryKey,
  getGetRegionsQueryKey,
  NetworkNode,
  RoutePlan,
} from "@workspace/api-client-react";

function viewportForCoordinates(
  coordinates: number[][],
): { lat: number; lon: number; zoom: number } | null {
  if (!coordinates.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  const lon = (minLon + maxLon) / 2;
  const lat = (minLat + maxLat) / 2;
  const span = Math.max(maxLon - minLon, maxLat - minLat);

  let zoom = 12;
  if (span > 1) zoom = 8;
  else if (span > 0.5) zoom = 9;
  else if (span > 0.25) zoom = 10;
  else if (span > 0.1) zoom = 11;
  else if (span > 0.05) zoom = 12;
  else zoom = 13;

  return { lat, lon, zoom };
}

// Maximum span (in degrees) of the current view for which we still pre-load
// neighbours. At low zoom a single view already covers a huge area, so
// pre-loading the surrounding ring would mean very large Overpass queries for
// little benefit — skip pre-loading in that case.
const MAX_PREFETCH_SPAN_DEG = 0.6;

// Compute the bbox strings for the eight tiles surrounding the current view.
// Each neighbour keeps the same width/height as the current view and is shifted
// by one full view in the relevant direction. The values are formatted exactly
// like the map's snapped bboxes (`Number(v.toFixed(3))`), so when the user pans
// one screen over the resulting query key matches and is served from cache.
function neighbourBboxes(bbox: string): string[] {
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [];
  const [west, south, east, north] = parts;
  const width = east - west;
  const height = north - south;
  if (width <= 0 || height <= 0) return [];
  if (width > MAX_PREFETCH_SPAN_DEG || height > MAX_PREFETCH_SPAN_DEG) return [];

  const fmt = (v: number) => Number(v.toFixed(3));
  const result: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nw = fmt(west + dx * width);
      const ne = fmt(east + dx * width);
      const ns = fmt(south + dy * height);
      const nn = fmt(north + dy * height);
      if (ns < -90 || nn > 90 || nw < -180 || ne > 180) continue;
      result.push(`${nw},${ns},${ne},${nn}`);
    }
  }
  return result;
}

export function useRoutePlanner() {
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuth();
  const [bbox, setBbox] = useState<string>("");
  const [debouncedBbox] = useDebounce(bbox, 500);
  
  const [selectedNodes, setSelectedNodes] = useState<NetworkNode[]>([]);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  
  const [importedCoordinates, setImportedCoordinates] = useState<number[][] | null>(null);
  const [flyToRegion, setFlyToRegion] = useState<{ lat: number; lon: number; zoom: number } | null>(null);

  // Network Query
  const { data: networkData, isFetching: isNetworkLoading } = useGetNetwork(
    { bbox: debouncedBbox },
    { 
      query: { 
        enabled: !!debouncedBbox, 
        queryKey: getGetNetworkQueryKey({ bbox: debouncedBbox }),
        placeholderData: keepPreviousData,
      } 
    }
  );

  // Pre-load neighbouring areas in the background once the current view has
  // settled and its network data has arrived. This warms both the client-side
  // query cache (so a one-screen pan resolves instantly) and the server-side
  // tile cache, without blocking or refetching the current view.
  const prefetchedBboxRef = useRef<string | null>(null);
  useEffect(() => {
    // Only start once the current view's data has loaded and nothing is in
    // flight, so background pre-loading never competes with the visible query.
    if (!debouncedBbox || !networkData || isNetworkLoading) return;
    if (prefetchedBboxRef.current === debouncedBbox) return;
    prefetchedBboxRef.current = debouncedBbox;

    const neighbours = neighbourBboxes(debouncedBbox);
    if (neighbours.length === 0) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      for (const nbBbox of neighbours) {
        void queryClient.prefetchQuery({
          queryKey: getGetNetworkQueryKey({ bbox: nbBbox }),
          queryFn: ({ signal }) => getNetwork({ bbox: nbBbox }, { signal }),
          // Treat freshly pre-loaded tiles as fresh for a while so panning back
          // and forth doesn't keep re-issuing the same neighbour fetches.
          staleTime: 5 * 60 * 1000,
        });
      }
    };

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(run);
    } else {
      timeoutId = setTimeout(run, 300);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [debouncedBbox, networkData, isNetworkLoading, queryClient]);

  // Regions Query
  const { data: regions } = useGetRegions({
    query: {
      queryKey: getGetRegionsQueryKey()
    }
  });

  // Route Mutation
  const planRoute = usePlanRoute();

  const handleNodeClick = useCallback((node: NetworkNode) => {
    setSelectedNodes(prev => {
      // Don't add if it's the exact same node as the last one
      if (prev.length > 0 && prev[prev.length - 1].id === node.id) {
        return prev;
      }
      
      const newSelection = [...prev, node];
      
      if (newSelection.length >= 2) {
        setRouteError(null);
        planRoute.mutate(
          { data: { nodes: newSelection } },
          {
            onSuccess: (plan) => {
              setRoutePlan(plan);
            },
            onError: (err) => {
              setRouteError(err.message || "Could not find a connecting path between these nodes.");
              // revert the last selection if it failed to route
              setSelectedNodes(prevSelection => prevSelection.slice(0, -1));
            }
          }
        );
      }
      
      return newSelection;
    });
  }, [planRoute]);

  const handleUndo = useCallback(() => {
    setSelectedNodes(prev => {
      const newSelection = prev.slice(0, -1);
      
      if (newSelection.length < 2) {
        setRoutePlan(null);
        setRouteError(null);
      } else {
        // Re-plan with remaining nodes
        planRoute.mutate(
          { data: { nodes: newSelection } },
          {
            onSuccess: (plan) => setRoutePlan(plan),
            onError: (err) => setRouteError(err.message || "Failed to compute route.")
          }
        );
      }
      
      return newSelection;
    });
  }, [planRoute]);

  const handleClear = useCallback(() => {
    setSelectedNodes([]);
    setRoutePlan(null);
    setRouteError(null);
    setImportedCoordinates(null);
  }, []);

  // Saved routes — only loaded for signed-in users; they are scoped to the
  // authenticated account so they follow the user across devices.
  const { data: savedRoutes, isLoading: isLoadingSavedRoutes } = useListSavedRoutes({
    query: {
      queryKey: getListSavedRoutesQueryKey(),
      enabled: !!isSignedIn,
    },
  });

  const saveRouteMutation = useSaveRoute();
  const deleteRouteMutation = useDeleteSavedRoute();
  const updateRouteMutation = useUpdateSavedRoute();

  const handleSaveRoute = useCallback(
    (name: string) => {
      if (!routePlan || selectedNodes.length < 2) return;
      saveRouteMutation.mutate(
        {
          data: {
            name,
            nodes: selectedNodes.map((n) => ({
              id: n.id,
              ref: n.ref,
              lat: n.lat,
              lon: n.lon,
            })),
            plan: routePlan,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSavedRoutesQueryKey() });
          },
        },
      );
    },
    [routePlan, selectedNodes, saveRouteMutation, queryClient],
  );

  const handleImportRoute = useCallback((coordinates: number[][]) => {
    setImportedCoordinates(coordinates);
    const viewport = viewportForCoordinates(coordinates);
    if (viewport) {
      setFlyToRegion(viewport);
    }
  }, []);

  const [openingRouteId, setOpeningRouteId] = useState<string | null>(null);

  const handleOpenSavedRoute = useCallback(async (id: string) => {
    setOpeningRouteId(id);
    try {
      const route = await getSavedRoute(id);
      setSelectedNodes(route.nodes as NetworkNode[]);
      setRoutePlan(route.plan);
      setRouteError(null);
      setImportedCoordinates(null);
      const viewport = viewportForCoordinates(route.plan.coordinates);
      if (viewport) {
        setFlyToRegion(viewport);
      }
    } catch (err) {
      setRouteError(
        err instanceof Error ? err.message : "Failed to open saved route.",
      );
    } finally {
      setOpeningRouteId(null);
    }
  }, []);

  const handleDeleteSavedRoute = useCallback(
    (id: string) => {
      deleteRouteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSavedRoutesQueryKey() });
          },
        },
      );
    },
    [deleteRouteMutation, queryClient],
  );

  const handleRenameSavedRoute = useCallback(
    (id: string, name: string) => {
      return new Promise<void>((resolve, reject) => {
        updateRouteMutation.mutate(
          { id, data: { name } },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListSavedRoutesQueryKey() });
              resolve();
            },
            onError: (err) => reject(err),
          },
        );
      });
    },
    [updateRouteMutation, queryClient],
  );

  return {
    bbox,
    setBbox,
    networkData,
    isNetworkLoading,
    regions,
    selectedNodes,
    routePlan,
    routeError,
    isPlanningRoute: planRoute.isPending,
    importedCoordinates,
    setImportedCoordinates,
    handleImportRoute,
    flyToRegion,
    setFlyToRegion,
    handleNodeClick,
    handleUndo,
    handleClear,
    savedRoutes,
    isLoadingSavedRoutes,
    handleSaveRoute,
    isSavingRoute: saveRouteMutation.isPending,
    handleOpenSavedRoute,
    openingRouteId,
    handleDeleteSavedRoute,
    handleRenameSavedRoute,
    isRenamingRoute: updateRouteMutation.isPending,
  };
}
