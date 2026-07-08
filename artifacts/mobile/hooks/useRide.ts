import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import {
  useListVisitedSegments,
  useSaveVisitedSegments,
  getListVisitedSegmentsQueryKey,
  type VisitedSegment,
} from "@workspace/api-client-react";
import type { NetworkNode, RoutePlan } from "@/context/RoutePlannerContext";
import {
  legSegments,
  polylineLength,
  snapToRoute,
  RouteCoverage,
  type LegSegment,
  type LngLat,
} from "@/lib/ride-geo";
import {
  createVoiceGuide,
  phraseFor,
  voiceNodesFromLegs,
  type VoiceGuide,
} from "@/lib/ride-voice";
import { speakPrompt, stopSpeaking } from "@/lib/speech";
import { keepAwakeDuringRide, releaseKeepAwake } from "@/lib/keep-awake";

// A leg counts as completed once the rider has passed within this distance of
// its end node, absorbing GPS jitter around the knooppunt.
const COMPLETE_TOLERANCE_M = 20;

// GPS fixes with a reported accuracy worse than this are ignored entirely.
// Coarse network positioning can be hundreds of metres off and would
// otherwise snap onto the route and register phantom distance.
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
  /** Segments unlocked this session that weren't already in lifetime history. */
  newSegments: number;
  /** Lifetime unique segments (history + this session). Only shown when signed in. */
  totalSegments: number;
  /** Whether the rider was signed in, so lifetime totals are meaningful. */
  isSignedIn: boolean;
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
  /** Distance ridden so far, in metres. */
  progressMeters: number;
  /** Total planned distance, in metres. */
  totalMeters: number;
  /** Summary of the just-finished ride, or null when none to show. */
  rideSummary: RideSummary | null;
  /** Dismiss the end-of-ride summary. */
  dismissRideSummary: () => void;
  /** Whether voice prompts are muted. */
  isMuted: boolean;
  /** Toggle voice prompts on/off. */
  toggleMute: () => void;
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
  // model as saved routes). It seeds the lifetime segment total in the summary.
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
  // Absolute distance along the planned route of the last accepted fix.
  const [, setRouteProgressMeters] = useState(0);
  // Segments completed during the current ride, keyed for de-duplication.
  const [rideCompleted, setRideCompleted] = useState<Map<string, LockPoint>>(
    new Map(),
  );
  const [rideSummary, setRideSummary] = useState<RideSummary | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Active expo-location watch subscription, cleared when the ride stops.
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  // Guards against a slow permission/watch request resolving after stopRide.
  const ridingRef = useRef(false);
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
  // Per-ride voice guide deriving node/off-route speech events from fixes.
  const voiceGuideRef = useRef<VoiceGuide | null>(null);
  // Mirrors `isMuted` so the GPS callback reads the live value.
  const mutedRef = useRef(false);

  const routeCoords = routePlan?.coordinates ?? null;
  const totalMeters = routePlan?.distanceMeters ?? 0;

  const canRide =
    !!routePlan &&
    routePlan.legs.length > 0 &&
    (routePlan.coordinates?.length ?? 0) >= 2 &&
    selectedNodes.length >= 2;

  // Stable segment definitions for the active plan (keys, end distances,
  // midpoints).
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

  // Speak the prompts derived from one fix, respecting the mute toggle.
  const emitVoice = useCallback((distanceAlong: number, offRoute: boolean) => {
    const guide = voiceGuideRef.current;
    if (!guide) return;
    const events = guide.update(distanceAlong, offRoute);
    if (mutedRef.current) return;
    for (const event of events) speakPrompt(phraseFor(event));
  }, []);

  const handleFix = useCallback(
    (lon: number, lat: number, accuracy: number | null) => {
      // Reject coarse fixes outright: they can be hundreds of metres off and
      // would otherwise register phantom kilometres.
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
        emitVoice(routeProgressRef.current, true);
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
        emitVoice(snap.distanceAlong, false);
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
      emitVoice(routeProgress, false);

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
    [routeCoords, segments, persist, emitVoice],
  );

  const stopWatch = useCallback(() => {
    watchRef.current?.remove();
    watchRef.current = null;
  }, []);

  const startRide = useCallback(() => {
    if (!canRide || ridingRef.current) return;
    // Start a clean session so the end-of-ride summary reflects only this ride.
    // Freeze the lifetime history now: segments completed mid-ride are persisted
    // immediately and refetch `history`, so `stopRide` must diff against this.
    preRideHistoryRef.current = new Set(
      (history ?? []).map((h: VisitedSegment) => h.segmentKey),
    );
    setRideCompleted(new Map());
    savedKeysRef.current = new Set();
    setRideSummary(null);
    setProgressMeters(0);
    setRouteProgressMeters(0);
    startProgressRef.current = null;
    routeProgressRef.current = 0;
    lastFixTimeRef.current = null;
    coverageRef.current = new RouteCoverage();
    setRidePosition(null);
    setGpsError(null);
    // Fresh voice guide per ride, built from the plan's node positions.
    voiceGuideRef.current = routePlan
      ? createVoiceGuide(
          voiceNodesFromLegs(routePlan.legs, (coords) =>
            polylineLength(coords as LngLat[]),
          ),
        )
      : null;
    setIsRiding(true);
    ridingRef.current = true;

    // Keep the screen from auto-locking for the whole ride: locking would
    // suspend the foreground GPS watch and silence voice prompts. Best-effort
    // and fire-and-forget — tracking starts regardless.
    void keepAwakeDuringRide();

    (async () => {
      try {
        const { status } =
          await Location.requestForegroundPermissionsAsync();
        if (status !== Location.PermissionStatus.GRANTED) {
          setGpsError("denied");
          return;
        }
        // The ride may have been stopped while the permission dialog was up.
        if (!ridingRef.current) return;
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 5,
          },
          (pos) =>
            handleFix(
              pos.coords.longitude,
              pos.coords.latitude,
              typeof pos.coords.accuracy === "number"
                ? pos.coords.accuracy
                : null,
            ),
        );
        if (!ridingRef.current) {
          sub.remove();
          return;
        }
        watchRef.current = sub;
      } catch {
        setGpsError("unavailable");
      }
    })();
  }, [canRide, handleFix, history, routePlan]);

  const stopRide = useCallback(() => {
    ridingRef.current = false;
    stopWatch();
    void releaseKeepAwake();
    voiceGuideRef.current = null;
    stopSpeaking();
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
    setRideSummary({
      distanceMeters: progressMeters,
      newSegments,
      totalSegments,
      isSignedIn,
    });

    setIsRiding(false);
    setRidePosition(null);
  }, [stopWatch, persist, rideCompleted, progressMeters, isSignedIn]);

  const dismissRideSummary = useCallback(() => setRideSummary(null), []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      // Muting mid-prompt should silence it immediately.
      if (next) stopSpeaking();
      return next;
    });
  }, []);

  // Clean up the geolocation watch on unmount.
  useEffect(
    () => () => {
      ridingRef.current = false;
      stopWatch();
      void releaseKeepAwake();
    },
    [stopWatch],
  );

  // If the underlying plan changes (new route planned or cleared) while riding,
  // end the ride so stale progress can't bleed into the new plan.
  useEffect(() => {
    if (!ridingRef.current) return;
    ridingRef.current = false;
    stopWatch();
    void releaseKeepAwake();
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
    voiceGuideRef.current = null;
    stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePlan]);

  return {
    canRide,
    isRiding,
    startRide,
    stopRide,
    gpsError,
    ridePosition,
    progressMeters,
    totalMeters,
    rideSummary,
    dismissRideSummary,
    isMuted,
    toggleMute,
  };
}
