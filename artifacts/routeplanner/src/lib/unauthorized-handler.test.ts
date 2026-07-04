import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUnauthorizedHandler,
  getRegions,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";

// Let the handler's fire-and-forget async verification settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function statusOfRejection(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (err) {
    return (err as { status?: number }).status ?? 0;
  }
  throw new Error("expected the request to reject");
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe("central 401 handler", () => {
  it("invokes the registered handler and still rejects on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, { title: "Unauthorized" }),
    );

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    expect(await statusOfRejection(getRegions())).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not invoke the handler for non-401 errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(500, { title: "Server error" }),
    );

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    expect(await statusOfRejection(getRegions())).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not invoke the handler on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, []));

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(getRegions()).resolves.toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still rejects even when the handler itself throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, { title: "Unauthorized" }),
    );

    setUnauthorizedHandler(() => {
      throw new Error("handler boom");
    });

    expect(await statusOfRejection(getRegions())).toBe(401);
  });
});

describe("createUnauthorizedHandler (session verification)", () => {
  it("does not prompt when Clerk still mints a fresh token (transient 401)", async () => {
    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue("fresh-token");

    const handler = createUnauthorizedHandler({ getToken, onExpired });
    handler();
    await flush();

    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("prompts when Clerk cannot mint a token (session gone)", async () => {
    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue(null);

    const handler = createUnauthorizedHandler({ getToken, onExpired });
    handler();
    await flush();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("prompts when the token refresh throws", async () => {
    const onExpired = vi.fn();
    const getToken = vi.fn().mockRejectedValue(new Error("network"));

    const handler = createUnauthorizedHandler({ getToken, onExpired });
    handler();
    await flush();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("stays silent while not ready (e.g. Clerk still loading)", async () => {
    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue(null);

    const handler = createUnauthorizedHandler({
      getToken,
      onExpired,
      isReady: () => false,
    });
    handler();
    await flush();

    expect(getToken).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("collapses a burst of 401s into a single prompt, then prompts again after the debounce", async () => {
    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue(null);
    let clock = 10_000;

    const handler = createUnauthorizedHandler({
      getToken,
      onExpired,
      now: () => clock,
      debounceMs: 3000,
    });

    // Burst: each verification runs sequentially once the previous settles.
    handler();
    await flush();
    handler();
    await flush();
    expect(onExpired).toHaveBeenCalledTimes(1);

    // Still inside the debounce window — no new prompt.
    clock = 12_000;
    handler();
    await flush();
    expect(onExpired).toHaveBeenCalledTimes(1);

    // Past the window — a fresh expiry prompts again.
    clock = 13_500;
    handler();
    await flush();
    expect(onExpired).toHaveBeenCalledTimes(2);
  });
});
