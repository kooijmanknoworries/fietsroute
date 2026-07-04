import React, { createContext, useContext } from "react";
import { useAuth } from "@clerk/expo";
import { useRoutePlanner } from "@/context/RoutePlannerContext";
import { useRide, type RideState } from "@/hooks/useRide";

const RideContext = createContext<RideState | null>(null);

export function RideProvider({ children }: { children: React.ReactNode }) {
  const { routePlan, selectedNodes } = useRoutePlanner();
  const { isSignedIn } = useAuth();

  const ride = useRide({
    routePlan,
    selectedNodes,
    isSignedIn: !!isSignedIn,
  });

  return <RideContext.Provider value={ride}>{children}</RideContext.Provider>;
}

export function useRideContext(): RideState {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error("useRideContext must be used inside RideProvider");
  return ctx;
}
