// Mock for expo-keep-awake under vitest/jsdom: the native module has no DOM
// equivalent. Tests assert on these fns to verify ride-time screen locking.
import { vi } from "vitest";

export const activateKeepAwakeAsync = vi.fn(async () => {});
export const deactivateKeepAwake = vi.fn(async () => {});
