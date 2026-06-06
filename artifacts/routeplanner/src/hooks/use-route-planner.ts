import { useState, useCallback, useMemo } from "react";
import { useDebounce } from "use-debounce";
import { 
  useGetNetwork, 
  usePlanRoute, 
  useGetRegions,
  getGetNetworkQueryKey,
  getGetRegionsQueryKey,
  NetworkNode,
  RoutePlan,
  Region
} from "@workspace/api-client-react";

export function useRoutePlanner() {
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
    flyToRegion,
    setFlyToRegion,
    handleNodeClick,
    handleUndo,
    handleClear
  };
}
