import { afterEach, describe, expect, it, vi } from "vitest";
import { getRegions, setUnauthorizedHandler } from "@workspace/api-client-react";

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
