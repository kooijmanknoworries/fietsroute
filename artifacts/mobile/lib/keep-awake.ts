// Thin wrapper around expo-keep-awake for ride tracking. On a bike the phone
// would normally auto-lock, which suspends the foreground location watch and
// silences voice prompts (Expo Go has no background-location task support).
// Keeping the screen awake for the duration of a ride is the reliable way to
// keep GPS fixes and expo-speech prompts flowing. Isolated in a module so the
// ride hook stays testable (tests mock this module).
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

// Dedicated tag so we never fight with other keep-awake consumers.
const RIDE_TAG = "ride-tracking";

/** Prevent the screen from auto-locking while a ride is in progress. */
export async function keepAwakeDuringRide(): Promise<void> {
  try {
    await activateKeepAwakeAsync(RIDE_TAG);
  } catch {
    // Best-effort: unsupported platforms (e.g. some browsers) simply keep
    // their normal lock behaviour; ride tracking itself must not break.
  }
}

/** Allow the screen to auto-lock again once the ride has ended. */
export async function releaseKeepAwake(): Promise<void> {
  try {
    await deactivateKeepAwake(RIDE_TAG);
  } catch {
    // Ignore: nothing to release or platform unsupported.
  }
}
