import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NetworkNode, RoutePlan } from "@workspace/api-client-react";
import {
  buildManeuvers,
  phraseFor,
  APPROACH_LEAD_M,
  IMMEDIATE_LEAD_M,
  type Maneuver,
} from "@/lib/voice-instructions";

// Dutch (Flemish) voice the user installed on the Piper TTS server. Requests go
// to the same origin under /voice/*, which Caddy proxies to the piper-tts
// container (see deploy/selfhost/Caddyfile).
const VOICE = "nl_BE-nathalie-medium";
const TTS_ENDPOINT = "/voice/tts";

const STORAGE_KEY = "fietsroute.voiceGuidance";

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export interface VoiceGuidanceState {
  /** Whether spoken guidance is switched on (persisted across sessions). */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** True while the browser lacks the APIs needed to play audio. */
  unsupported: boolean;
}

interface UseVoiceGuidanceOptions {
  routePlan: RoutePlan | null;
  selectedNodes: NetworkNode[];
  isRiding: boolean;
  /** Live along-route position in metres from the ride hook. */
  routeProgressMeters: number;
}

type Phase = "approach" | "immediate";

export function useVoiceGuidance({
  routePlan,
  selectedNodes,
  isRiding,
  routeProgressMeters,
}: UseVoiceGuidanceOptions): VoiceGuidanceState {
  const unsupported =
    typeof window === "undefined" ||
    typeof window.Audio === "undefined" ||
    typeof fetch === "undefined";

  const [enabled, setEnabledState] = useState<boolean>(() => readEnabled());

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Ignore storage failures (private mode); the toggle still works in-session.
    }
  }, []);

  const maneuvers: Maneuver[] = useMemo(() => {
    if (!routePlan) return [];
    const nodeRefs =
      selectedNodes.length > 0
        ? selectedNodes.map((n) => n.ref)
        : routePlan.nodeRefs;
    return buildManeuvers(routePlan.legs, nodeRefs);
  }, [routePlan, selectedNodes]);

  // Cache synthesized audio by spoken text so repeated phrases replay instantly
  // and don't re-hit the TTS server.
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  // Serialise playback so overlapping announcements don't talk over each other.
  const playingRef = useRef<Promise<void>>(Promise.resolve());
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Which (maneuver index + phase) announcements have already been spoken this
  // ride, so we never repeat the same instruction.
  const spokenRef = useRef<Set<string>>(new Set());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const fetchAudioUrl = useCallback(async (text: string): Promise<string> => {
    const cached = audioCacheRef.current.get(text);
    if (cached) return cached;
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: VOICE }),
    });
    if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCacheRef.current.set(text, url);
    return url;
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (unsupported || !enabledRef.current) return;
      // Chain onto the current playback so instructions are spoken in order.
      playingRef.current = playingRef.current
        .catch(() => {})
        .then(async () => {
          if (!enabledRef.current) return;
          const url = await fetchAudioUrl(text);
          if (!enabledRef.current) return;
          await new Promise<void>((resolve) => {
            const audio = new Audio(url);
            currentAudioRef.current = audio;
            const done = () => {
              currentAudioRef.current = null;
              resolve();
            };
            audio.onended = done;
            audio.onerror = done;
            void audio.play().catch(done);
          });
        })
        .catch(() => {
          // Swallow TTS/playback errors: guidance is best-effort and must never
          // interrupt the ride.
        });
    },
    [unsupported, fetchAudioUrl],
  );

  const stopPlayback = useCallback(() => {
    const audio = currentAudioRef.current;
    if (audio) {
      audio.pause();
      currentAudioRef.current = null;
    }
    playingRef.current = Promise.resolve();
  }, []);

  // Reset per-ride announcement state whenever a ride starts/stops or the plan
  // changes, and speak the start instruction on kickoff.
  useEffect(() => {
    spokenRef.current = new Set();
    if (!isRiding) {
      stopPlayback();
      return;
    }
    if (!enabled) return;
    const start = maneuvers.find((m) => m.type === "start");
    if (start) {
      spokenRef.current.add("0:immediate");
      speak(phraseFor(start, "immediate"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRiding, maneuvers, enabled]);

  // Drive announcements from the live along-route position: as the rider nears
  // each maneuver, speak the approach cue once and the immediate cue once.
  useEffect(() => {
    if (!isRiding || !enabled || maneuvers.length === 0) return;
    for (let i = 0; i < maneuvers.length; i++) {
      const m = maneuvers[i];
      if (m.type === "start") continue;
      const remaining = m.distanceAlong - routeProgressMeters;
      if (remaining < -IMMEDIATE_LEAD_M) continue; // already passed

      const immediateKey = `${i}:immediate`;
      const approachKey = `${i}:approach`;

      if (
        remaining <= IMMEDIATE_LEAD_M &&
        remaining >= -IMMEDIATE_LEAD_M &&
        !spokenRef.current.has(immediateKey)
      ) {
        spokenRef.current.add(immediateKey);
        spokenRef.current.add(approachKey); // no approach cue if we're already there
        speak(phraseFor(m, "immediate" as Phase));
      } else if (
        remaining <= APPROACH_LEAD_M &&
        remaining > IMMEDIATE_LEAD_M &&
        !spokenRef.current.has(approachKey)
      ) {
        spokenRef.current.add(approachKey);
        speak(phraseFor(m, "approach" as Phase));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProgressMeters, isRiding, enabled, maneuvers]);

  // Release object URLs on unmount.
  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      stopPlayback();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, [stopPlayback]);

  return { enabled: enabled && !unsupported, setEnabled, unsupported };
}
