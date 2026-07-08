import { vi } from "vitest";

export const speak = vi.fn();
export const stop = vi.fn();
export const isSpeakingAsync = vi.fn(async () => false);
