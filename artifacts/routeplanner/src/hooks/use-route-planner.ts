import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
        queryKey: getGetNetworkQueryKey({ bbox: debouncedBbox })
      } 
    }
  );

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
