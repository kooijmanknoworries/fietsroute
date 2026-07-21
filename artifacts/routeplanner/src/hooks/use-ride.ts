import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVisitedSegments,
  useSaveVisitedSegments,
  getListVisitedSegmentsQueryKey,
  type NetworkNode,
  type RoutePlan,
  type VisitedSegment,
} from "@workspace/api-client-react";
import {
  legSegments,
  snapToRoute,
  sliceRoute,
  RouteCoverage,
  type LegSegment,
  type LngLat,
} from "@/lib/ride-geo";

// A leg counts as completed once the rider has passed within this distance of
// its end node, absorbing GPS jitter around the knooppunt.
const COMPLETE_TOLERANCE_M = 20;

// GPS fixes with a reported accuracy worse than this are ignored entirely.
// Desktop browsers often fall back to coarse IP/wifi positioning (hundreds of
// metres to kilometres off), which would otherwise snap onto the route and
// register phantom distance.
const MAX_ACCURACY_M = 50;

// Fixes further than this from the planned route don't advance progress: the
// rider is off-route (or the fix is bogus), so we show their real position but
// never credit route distance for it.
const MAX_OFF_ROUTE_M = 50;

// Progress along the route may never advance faster than this between two
// fixes (with a small slack for sparse updates). ~54 km/h comfortably covers
// fast cycling while rejecting GPS teleports that would register absurd speeds.
const MAX_SPEED_MPS = 15;
const JUMP_SLACK_M = 30;

export interface LockPoint {
  key: string;
  lon: number;
  lat: number;
}

export interface RideSummary {
  /** Distance ridden during this session, in metres. */
  distanceMeters: number;
  /** Wall-clock elapsed time from start to stop, in seconds. */
  durationSeconds: number;
  /**
   * Average speed in km/h, from distance over elapsed wall-clock time. Null when
   * the ride was too short to compute a meaningful figure.
   */
  avgSpeedKmh: number | null;
  /** Segments unlocked this session that weren't already in lifetime history. */
  newSegments: number;
  /** Lifetime unique segments (history + this session). */
  totalSegments: number;
}

export interface RideState {
  /** Whether a rideable (node-based) plan exists to start a ride from. */
  canRide: boolean;
  isRiding: boolean;
  startRide: () => void;
  stopRide: () => void;
  /** Human-readable GPS problem, or null when tracking is healthy. */
  gpsError: "denied" | "unavailable" | null;
  /** Live snapped position as [lon, lat], or null before the first fix. */
  ridePosition: LngLat | null;
  /** Whether the map should recenter to follow the rider. */
  followRide: boolean;
  /** Stop auto-following (called when the rider pans/zooms the map). */
  pauseFollow: () => void;
  /** Resume auto-following and recenter on the live position. */
  resumeFollow: () => void;
  /** The travelled portion of the route, for recolouring. */
  traveledCoordinates: number[][] | null;
  /** Distance ridden so far, in metres. */
  progressMeters: number;
  /**
   * Absolute distance (metres) of the live position along the planned route,
   * measured from the route start. Unlike `progressMeters` (which is relative
   * to where the ride began), this is the along-route position voice guidance
   * uses to decide which maneuver comes next.
   */
  routeProgressMeters: number;
  /** Total planned distance, in metres. */
  totalMeters: number;
  /** Lock markers: persisted history merged with this ride's completions. */
  lockPoints: LockPoint[];
  /** Summary of the just-finished ride, or null when none to show. */
  rideSummary: RideSummary | null;
  /** Dismiss the end-of-ride summary. */
  dismissRideSummary: () => void;
}

interface UseRideOptions {
  routePlan: RoutePlan | null;
  selectedNodes: NetworkNode[];
  isSignedIn: boolean;
}

export function useRide({
  routePlan,
  selectedNodes,
  isSignedIn,
}: UseRideOptions): RideState {
  const queryClient = useQueryClient();
  const saveMutation = useSaveVisitedSegments();

  // Permanent history is only available to signed-in riders (same ownership
  // model as saved routes). It drives the lock markers shown on every visit.
  const { data: history } = useListVisitedSegments({
    query: {
      queryKey: getListVisitedSegmentsQueryKey(),
      enabled: isSignedIn,
    },
  });

  const [isRiding, setIsRiding] = useState(false);
  const [gpsError, setGpsError] = useState<"denied" | "unavailable" | null>(
    null,
  );
  const [ridePosition, setRidePosition] = useState<LngLat | null>(null);
  const [progressMeters, setProgressMeters] = useState(0);
  // Absolute distance along the planned route of the last accepted fix, used
  // for recolouring the travelled portion and latching segment completions.
  const [routeProgressMeters, setRouteProgressMeters] = useState(0);
  const [followRide, setFollowRide] = useState(true);
  // Segments completed during the current ride, keyed for de-duplication.
  const [rideCompleted, setRideCompleted] = useState<Map<string, LockPoint>>(
    new Map(),
  );
  const [rideSummary, setRideSummary] = useState<RideSummary | null>(null);

  const watchIdRef = useRef<number | null>(null);
  // Wall-clock timestamp (ms) when the current ride started, used to compute
  // elapsed time and average speed for the summary. Wall-clock time absorbs GPS
  // gaps and pauses gracefully — the rider's total ride time is start-to-stop.
  const rideStartRef = useRef<number | null>(null);
  // Segment keys already sent to the server, so we only persist new ones.
  const savedKeysRef = useRef<Set<string>>(new Set());
  // Lifetime segment keys as they were when this ride started. Segments
  // completed during the ride are persisted immediately, which refetches
  // `history`, so we must diff against this frozen baseline (not live history)
  // to count what the rider genuinely unlocked this session.
  const preRideHistoryRef = useRef<Set<string>>(new Set());
  // Along-route distance of the first accepted on-route fix. Distance ridden
  // is measured relative to this baseline, so starting a ride mid-route (or a
  // first fix that lands mid-route) never registers instant kilometres.
  const startProgressRef = useRef<number | null>(null);
  // Along-route distance of the last accepted fix (monotonic).
  const routeProgressRef = useRef(0);
  // Timestamp (ms) of the last accepted fix, for the plausible-speed gate.
  const lastFixTimeRef = useRef<number | null>(null);
  // Which stretches of the route were continuously ridden this session. A leg
  // only unlocks when coverage spans it start-to-end: joining mid-leg or
  // jumping over a stretch never credits the un-ridden part.
  const coverageRef = useRef(new RouteCoverage());

  const routeCoords = routePlan?.coordinates ?? null;
  const totalMeters = routePlan?.distanceMeters ?? 0;

  const canRide =
    !!routePlan &&
    routePlan.legs.length > 0 &&
    (routePlan.coordinates?.length ?? 0) >= 2 &&
    selectedNodes.length >= 2;

  // Stable segment definitions for the active plan (keys, end distances,
  // midpoints for the lock markers).
  const segments: LegSegment[] = useMemo(() => {
    if (!routePlan) return [];
    return legSegments(routePlan.legs, selectedNodes);
  }, [routePlan, selectedNodes]);

  const persist = useCallback(
    (points: LockPoint[]) => {
      if (!isSignedIn || points.length === 0) return;
      const bySegment = new Map(segments.map((s) => [s.segmentKey, s]));
      const payload: VisitedSegment[] = [];
      for (const point of points) {
        if (savedKeysRef.current.has(point.key)) continue;
        const seg = bySegment.get(point.key);
        if (!seg) continue;
        savedKeysRef.current.add(point.key);
        payload.push({
          segmentKey: seg.segmentKey,
          fromRef: seg.fromRef,
          toRef: seg.toRef,
          lon: point.lon,
          lat: point.lat,
        });
      }
      if (payload.length === 0) return;
      saveMutation.mutate(
        { data: { segments: payload } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListVisitedSegmentsQueryKey(),
            });
          },
          onError: () => {
            // Allow a later flush to retry these keys.
            for (const p of payload) savedKeysRef.current.delete(p.segmentKey);
          },
        },
      );
    },
    [isSignedIn, segments, saveMutation, queryClient],
  );

  const handleFix = useCallback(
    (lon: number, lat: number, accuracy: number | null) => {
      // Reject coarse fixes outright (IP/wifi positioning on desktops can be
      // kilometres off and would otherwise register phantom kilometres).
      if (accuracy !== null && accuracy > MAX_ACCURACY_M) return;
      setGpsError(null);
      if (!routeCoords || routeCoords.length < 2) {
        setRidePosition([lon, lat]);
        return;
      }
      const snap = snapToRoute(routeCoords as LngLat[], [lon, lat]);
      if (!snap) {
        setRidePosition([lon, lat]);
        return;
      }

      // Off-route: show the rider's true position but never credit distance.
      if (snap.distanceToRoute > MAX_OFF_ROUTE_M) {
        setRidePosition([lon, lat]);
        return;
      }

      const now = Date.now();

      // First accepted on-route fix sets the baseline: distance ridden starts
      // at zero from wherever the rider actually is on the route.
      if (startProgressRef.current === null) {
        startProgressRef.current = snap.distanceAlong;
        routeProgressRef.current = snap.distanceAlong;
        lastFixTimeRef.current = now;
        coverageRef.current.markAt(snap.distanceAlong);
        setRidePosition(snap.snapped);
        setRouteProgressMeters(snap.distanceAlong);
        setProgressMeters(0);
        return;
      }

      const prevProgress = routeProgressRef.current;
      const delta = snap.distanceAlong - prevProgress;
      const dtSeconds = Math.max(
        1,
        (now - (lastFixTimeRef.current ?? now)) / 1000,
      );
      const maxAdvance = MAX_SPEED_MPS * dtSeconds + JUMP_SLACK_M;

      if (delta > maxAdvance) {
        // Implausible teleport along the route (GPS glitch): show the
        // position but do not credit the jump as ridden distance.
        setRidePosition(snap.snapped);
        return;
      }

      setRidePosition(snap.snapped);
      if (delta > 0) {
        coverageRef.current.advance(prevProgress, snap.distanceAlong);
        routeProgressRef.current = snap.distanceAlong;
        lastFixTimeRef.current = now;
      }
      const routeProgress = routeProgressRef.current;
      const startProgress = startProgressRef.current ?? 0;
      setRouteProgressMeters(routeProgress);
      setProgressMeters(Math.max(0, routeProgress - startProgress));

      // Latch legs whose full extent has been continuously covered by accepted
      // fixes (monotonic — never un-mark). Joining a leg mid-way or skipping a
      // stretch (shortcut, snap-ahead, GPS gap) never credits that leg.
      const coverage = coverageRef.current;
      const newlyDone: LockPoint[] = [];
      setRideCompleted((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const seg of segments) {
          if (next.has(seg.segmentKey)) continue;
          if (
            coverage.covers(
              seg.startDistance,
              seg.endDistance,
              COMPLETE_TOLERANCE_M,
            )
          ) {
            const point: LockPoint = {
              key: seg.segmentKey,
              lon: seg.midpoint[0],
              lat: seg.midpoint[1],
            };
            next.set(seg.segmentKey, point);
            newlyDone.push(point);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (newlyDone.length > 0) persist(newlyDone);
    },
    [routeCoords, segments, persist],
  );

  // Temporarily stop the map from snapping back to the rider (they panned or
  // zoomed to look ahead); resume re-enables following, which immediately
  // recenters on the current position via the map's follow effect.
  const pauseFollow = useCallback(() => setFollowRide(false), []);
  const resumeFollow = useCallback(() => setFollowRide(true), []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const startRide = useCallback(() => {
    if (!canRide) return;
    // Start a clean session so the end-of-ride summary reflects only this ride.
    // Freeze the lifetime history now: segments completed mid-ride are persisted
    // immediately and refetch `history`, so `stopRide` must diff against this.
    preRideHistoryRef.current = new Set(
      (history ?? []).map((h) => h.segmentKey),
    );
    rideStartRef.current = Date.now();
    setRideCompleted(new Map());
    savedKeysRef.current = new Set();
    setRideSummary(null);
    if (!("geolocation" in navigator)) {
      setGpsError("unavailable");
      setIsRiding(true);
      return;
    }
    setIsRiding(true);
    setFollowRide(true);
    setGpsError(null);
    setProgressMeters(0);
    setRouteProgressMeters(0);
    startProgressRef.current = null;
    routeProgressRef.current = 0;
    lastFixTimeRef.current = null;
    coverageRef.current = new RouteCoverage();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        handleFix(
          pos.coords.longitude,
          pos.coords.latitude,
          typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
        ),
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }, [canRide, handleFix, history]);

  const stopRide = useCallback(() => {
    stopWatch();
    // Final flush of anything not yet persisted.
    persist([...rideCompleted.values()]);

    // Build a satisfying end-of-ride summary. "New" segments are those unlocked
    // this session that weren't part of the lifetime history *when the ride
    // started* — diffing against the frozen baseline avoids undercounting, since
    // completed segments are persisted mid-ride and refetch live `history`.
    const baseline = preRideHistoryRef.current;
    let newSegments = 0;
    for (const key of rideCompleted.keys()) {
      if (!baseline.has(key)) newSegments++;
    }
    const totalSegments = new Set([...baseline, ...rideCompleted.keys()]).size;

    // Elapsed time and average speed use wall-clock start-to-stop time, which
    // handles GPS gaps and pauses gracefully. Avg speed is left null for very
    // short rides where the figure would be noisy/meaningless.
    const startedAt = rideStartRef.current;
    const durationSeconds =
      startedAt !== null ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
    const avgSpeedKmh =
      durationSeconds >= 1 && progressMeters > 0
        ? progressMeters / 1000 / (durationSeconds / 3600)
        : null;

    setRideSummary({
      distanceMeters: progressMeters,
      durationSeconds,
      avgSpeedKmh,
      newSegments,
      totalSegments,
    });

    setIsRiding(false);
    setRidePosition(null);
    setFollowRide(true);
  }, [stopWatch, persist, rideCompleted, progressMeters, isSignedIn]);

  const dismissRideSummary = useCallback(() => setRideSummary(null), []);

  // Clean up the geolocation watch on unmount.
  useEffect(() => stopWatch, [stopWatch]);

  // If the underlying plan changes (new route planned or cleared) while riding,
  // end the ride so stale progress can't bleed into the new plan.
  useEffect(() => {
    if (!isRiding) return;
    stopWatch();
    setIsRiding(false);
    setRidePosition(null);
    setProgressMeters(0);
    setRouteProgressMeters(0);
    startProgressRef.current = null;
    routeProgressRef.current = 0;
    lastFixTimeRef.current = null;
    coverageRef.current = new RouteCoverage();
    setRideCompleted(new Map());
    savedKeysRef.current = new Set();
    setRideSummary(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePlan]);

  const traveledCoordinates = useMemo(() => {
    if (!isRiding || !routeCoords || progressMeters <= 0) return null;
    return sliceRoute(routeCoords as LngLat[], routeProgressMeters).traveled;
  }, [isRiding, routeCoords, progressMeters, routeProgressMeters]);

  // Lock markers: persisted history plus the current ride's completions,
  // de-duplicated by segment key.
  const lockPoints = useMemo(() => {
    const merged = new Map<string, LockPoint>();
    for (const h of history ?? []) {
      merged.set(h.segmentKey, {
        key: h.segmentKey,
        lon: h.lon,
        lat: h.lat,
      });
    }
    for (const [key, point] of rideCompleted) merged.set(key, point);
    return [...merged.values()];
  }, [history, rideCompleted]);

  return {
    canRide,
    isRiding,
    startRide,
    stopRide,
    gpsError,
    ridePosition,
    followRide,
    pauseFollow,
    resumeFollow,
    traveledCoordinates,
    progressMeters,
    routeProgressMeters,
    totalMeters,
    lockPoints,
    rideSummary,
    dismissRideSummary,
  };
}
