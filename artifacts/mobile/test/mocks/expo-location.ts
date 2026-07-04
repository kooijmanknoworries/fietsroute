import { vi } from "vitest";

// Lightweight expo-location stand-in so ride-tracking code can load and run
// under jsdom. Tests that need to drive GPS fixes override watchPositionAsync
// (or read the captured callback) via vi.mock / vi.mocked.

export enum PermissionStatus {
  GRANTED = "granted",
  DENIED = "denied",
  UNDETERMINED = "undetermined",
}

export enum Accuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export interface LocationSubscription {
  remove: () => void;
}

export const requestForegroundPermissionsAsync = vi.fn(async () => ({
  status: PermissionStatus.GRANTED,
}));

export const watchPositionAsync = vi.fn(
  async (
    _options: unknown,
    _callback: (pos: {
      coords: { latitude: number; longitude: number };
    }) => void,
  ): Promise<LocationSubscription> => ({ remove: vi.fn() }),
);
