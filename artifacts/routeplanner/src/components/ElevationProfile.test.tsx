import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import ElevationProfile from "./ElevationProfile";

const profileMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getElevationProfile: (...args: unknown[]) => profileMock(...args),
}));

// recharts' ResponsiveContainer needs real layout measurements that jsdom
// doesn't provide, so the chart svg itself won't render — the stats grid and
// container are what we assert on.

const COORDS = [
  [5.1, 52.09],
  [5.12, 52.1],
];

function renderProfile(coordinates: number[][]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ElevationProfile coordinates={coordinates} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // recharts' ResponsiveContainer requires ResizeObserver, absent in jsdom.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  profileMock.mockReset();
});

describe("ElevationProfile", () => {
  it("shows climb, highest and lowest stats once loaded", async () => {
    profileMock.mockResolvedValue({
      points: [
        { distanceMeters: 0, elevationMeters: 5 },
        { distanceMeters: 2000, elevationMeters: 42 },
      ],
      ascentMeters: 37,
      descentMeters: 0,
      minElevationMeters: 5,
      maxElevationMeters: 42,
      totalDistanceMeters: 2000,
    });

    renderProfile(COORDS);

    await waitFor(() =>
      expect(screen.getByTestId("elevation-ascent")).toBeTruthy(),
    );
    expect(screen.getByTestId("elevation-ascent").textContent).toContain("37 m");
    expect(screen.getByTestId("elevation-highest").textContent).toContain("42 m");
    expect(screen.getByTestId("elevation-lowest").textContent).toContain("5 m");
    expect(profileMock).toHaveBeenCalledWith({ coordinates: COORDS });
  });

  it("shows an error message when the profile can't load", async () => {
    profileMock.mockRejectedValue(new Error("boom"));

    renderProfile(COORDS);

    await waitFor(
      () =>
        expect(
          screen.getByText(/hoogteprofiel niet laden|Could not load/i),
        ).toBeTruthy(),
      { timeout: 5000 },
    );
  });

  it("renders nothing for fewer than two coordinates", () => {
    const { container } = renderProfile([[5.1, 52.09]]);
    expect(container.querySelector('[data-testid="elevation-profile"]')).toBeNull();
  });
});
