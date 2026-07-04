import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useDebounce } from "use-debounce";
import { useI18n } from "@/lib/i18n";
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
export const MAX_PREFETCH_SPAN_DEG = 0.6;

export interface Neighbour {
  bbox: string;
  // Offset of this tile from the current view, in whole-view steps. Used to
  // score the tile against the user's pan direction.
  dx: number;
  dy: number;
}

// Compute the eight tiles surrounding the current view. Each neighbour keeps
// the same width/height as the current view and is shifted by one full view in
// the relevant direction. The values are formatted exactly like the map's
// snapped bboxes (`Number(v.toFixed(3))`), so when the user pans one screen over
// the resulting query key matches and is served from cache.
export function neighbourBboxes(bbox: string): Neighbour[] {
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [];
  const [west, south, east, north] = parts;
  const width = east - west;
  const height = north - south;
  if (width <= 0 || height <= 0) return [];
  if (width > MAX_PREFETCH_SPAN_DEG || height > MAX_PREFETCH_SPAN_DEG) return [];

  const fmt = (v: number) => Number(v.toFixed(3));
  const result: Neighbour[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nw = fmt(west + dx * width);
      const ne = fmt(east + dx * width);
      const ns = fmt(south + dy * height);
      const nn = fmt(north + dy * height);
      if (ns < -90 || nn > 90 || nw < -180 || ne > 180) continue;
      result.push({ bbox: `${nw},${ns},${ne},${nn}`, dx, dy });
    }
  }
  return result;
}

// Split the surrounding neighbours into the ones the user is heading toward
// ("leading") and the rest ("trailing"), based on the most recent pan
// direction. The leading edge is fetched eagerly so panning that way stays
// instant; the trailing tiles are warmed lazily (and skipped on slow links),
// which keeps total background traffic down when the user keeps panning.
export function splitNeighboursByDirection(
  neighbours: Neighbour[],
  direction: { dx: number; dy: number } | null,
): { leading: Neighbour[]; trailing: Neighbour[] } {
  if (!direction) return { leading: neighbours, trailing: [] };
  const mag = Math.hypot(direction.dx, direction.dy);
  if (mag === 0) return { leading: neighbours, trailing: [] };

  const nx = direction.dx / mag;
  const ny = direction.dy / mag;

  const scored = neighbours.map((n) => {
    const omag = Math.hypot(n.dx, n.dy) || 1;
    // Cosine of the angle between the pan direction and this tile's offset.
    const dot = (n.dx * nx + n.dy * ny) / omag;
    return { n, dot };
  });
  scored.sort((a, b) => b.dot - a.dot);

  // Tiles within ~72° of the heading direction count as the leading edge.
  const leading = scored.filter((s) => s.dot > 0.3).map((s) => s.n);
  const trailing = scored.filter((s) => s.dot <= 0.3).map((s) => s.n);
  if (leading.length === 0) return { leading: neighbours, trailing: [] };
  return { leading, trailing };
}

// Heuristic for a slow / data-saver connection using the Network Information
// API where available. On such links we only warm the leading edge and skip
// the trailing tiles entirely.
export function isSlowConnection(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return /(^|-)2g$/.test(conn.effectiveType ?? "");
}

// Heuristic for a fast connection (reported "4g", no data-saver) where warming
// the trailing tiles a little sooner is cheap. Used to shrink the trailing
// pre-load delay so a quick reversal still resolves from cache. When the
// Network Information API is unavailable we don't assume fast.
function isFastConnection(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!conn) return false;
  if (conn.saveData) return false;
  return conn.effectiveType === "4g";
}

// Recent pans older than this are ignored when reasoning about pan direction.
const PAN_HISTORY_WINDOW_MS = 6000;

// Whether the user's recent pans include a reversal — i.e. two consecutive
// recent headings point in roughly opposite directions (negative dot product).
// When true the user is panning back and forth, so warming the trailing tiles
// eagerly (rather than after a delay) keeps the reverse pan instant.
function recentlyReversed(
  history: Array<{ dx: number; dy: number; t: number }>,
): boolean {
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    if (a.dx * b.dx + a.dy * b.dy < 0) return true;
  }
  return false;
}

// How long to wait before warming the trailing tiles (the ones behind the
// user's heading), in ms, or null to skip them entirely. Warming them lets a
// quick reversal still resolve from cache. We:
//   - skip them on slow / data-saver links to cut background traffic;
//   - warm them immediately when the user is already reversing/oscillating;
//   - otherwise warm them after a short delay — shrunk on fast connections, and
//     well under the old 1.5s so a reverse shortly after a pan still finds them
//     warm — short enough that a user who keeps panning the same way still
//     cancels them first (the effect re-runs and clears the pending timeout).
function trailingDelayMs(reversing: boolean): number | null {
  if (isSlowConnection()) return null;
  if (reversing) return 0;
  return isFastConnection() ? 300 : 700;
}

export function useRoutePlanner() {
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuth();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [bbox, setBbox] = useState<string>("");
  const [debouncedBbox] = useDebounce(bbox, 250);

  // Short rolling history of recent pan directions (newest last), each tagged
  // with the time it was reported. Used to (a) prioritise the latest heading
  // when pre-loading and (b) detect when the user is reversing/oscillating so
  // the opposite ("trailing") tiles can be warmed eagerly. Kept in a ref so
  // updating it never triggers a re-render or re-runs the pre-load effect.
  const panHistoryRef = useRef<Array<{ dx: number; dy: number; t: number }>>([]);
  const handleViewportChange = useCallback(
    (nextBbox: string, direction: { dx: number; dy: number } | null) => {
      if (direction) {
        const now = Date.now();
        const history = panHistoryRef.current.filter(
          (h) => now - h.t < PAN_HISTORY_WINDOW_MS,
        );
        history.push({ ...direction, t: now });
        // Keep only the few most recent entries — enough to spot a reversal.
        panHistoryRef.current = history.slice(-4);
      }
      setBbox(nextBbox);
    },
    [],
  );
  
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

    // Prioritise the tiles in the direction of the most recent pan. The leading
    // edge is fetched eagerly; the rest are warmed after an adaptive delay (or
    // eagerly if the user is reversing/oscillating) so a quick reverse pan still
    // resolves from cache while a user who keeps panning cancels them first.
    const history = panHistoryRef.current;
    const latest = history.length ? history[history.length - 1] : null;
    const reversing = recentlyReversed(history);
    const { leading, trailing } = splitNeighboursByDirection(neighbours, latest);
    const trailingDelay = trailingDelayMs(reversing);

    const prefetch = (nbBbox: string) => {
      void queryClient.prefetchQuery({
        queryKey: getGetNetworkQueryKey({ bbox: nbBbox }),
        queryFn: ({ signal }) => getNetwork({ bbox: nbBbox }, { signal }),
        // Treat freshly pre-loaded tiles as fresh for a while so panning back
        // and forth doesn't keep re-issuing the same neighbour fetches.
        staleTime: 5 * 60 * 1000,
      });
    };

    let cancelled = false;
    let trailingTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const runTrailing = () => {
      if (cancelled) return;
      for (const nb of trailing) prefetch(nb.bbox);
    };

    const runLeading = () => {
      if (cancelled) return;
      for (const nb of leading) prefetch(nb.bbox);

      // Warm the remaining neighbours lazily, at lower priority. A null delay
      // means skip them entirely (slow / data-saver links). A zero delay means
      // warm them now (the user is reversing/oscillating). Otherwise defer them
      // briefly so a user who keeps panning the same way cancels them first.
      if (trailing.length === 0 || trailingDelay === null) return;
      if (trailingDelay === 0) {
        runTrailing();
        return;
      }
      trailingTimeoutId = setTimeout(runTrailing, trailingDelay);
    };

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(runLeading);
    } else {
      timeoutId = setTimeout(runLeading, 300);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (trailingTimeoutId !== undefined) clearTimeout(trailingTimeoutId);
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

  // Turn an API failure into a short, friendly, translated message instead of
  // surfacing the raw server text (e.g. "HTTP 422 …: Could not locate node 63
  // or 08 on the cycling network"). A 422 means the endpoints couldn't be
  // connected; anything else is treated as a generic compute failure.
  const messageForRouteError = useCallback((err: unknown): string => {
    const status = (err as { status?: number } | null)?.status;
    if (status === 422) return tRef.current("error.noPath");
    return tRef.current("error.computeFailed");
  }, []);

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
              setRouteError(messageForRouteError(err));
              // revert the last selection if it failed to route
              setSelectedNodes(prevSelection => prevSelection.slice(0, -1));
            }
          }
        );
      }
      
      return newSelection;
    });
  }, [planRoute, messageForRouteError]);

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
            onError: (err) => setRouteError(messageForRouteError(err))
          }
        );
      }
      
      return newSelection;
    });
  }, [planRoute, messageForRouteError]);

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
        err instanceof Error ? err.message : tRef.current("error.openFailed"),
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
    handleViewportChange,
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
