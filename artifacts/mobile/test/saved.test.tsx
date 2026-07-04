import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Alert } from "react-native";
import type { SavedRouteSummary } from "@workspace/api-client-react";
import type { LocalRoute } from "@/lib/localRoutes";
import SavedRoutesScreen from "@/app/saved";

// --- Mocks -----------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  isSignedIn: true as boolean,
  signOut: vi.fn(),
  invalidateQueries: vi.fn(),
  loadPlan: vi.fn(),
  deleteMutate: vi.fn(),
}));

// signOut flips the shared auth flag so a re-render reflects the signed-out UI,
// mirroring how Clerk's signOut() drops the session on the device.
mocks.signOut.mockImplementation(async () => {
  mocks.isSignedIn = false;
});

const SERVER_ROUTES: SavedRouteSummary[] = [
  {
    id: "srv_1",
    name: "Account Rondje",
    distanceMeters: 4200,
    nodeRefs: ["63", "08"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const PLAN = {
  nodeRefs: ["21", "42"],
  coordinates: [
    [5.0, 52.0],
    [5.01, 52.01],
  ],
  distanceMeters: 3100,
  legs: [],
};

const LOCAL_ROUTES: LocalRoute[] = [
  {
    id: "bk_1",
    name: "Toestel Back-up",
    nodes: [
      { id: "1", ref: "21", lat: 52.0, lon: 5.0 },
      { id: "2", ref: "42", lat: 52.01, lon: 5.01 },
    ],
    plan: PLAN as unknown as LocalRoute["plan"],
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

vi.mock("@workspace/api-client-react", () => ({
  // Server routes only exist while signed in, matching the real hook whose
  // query is gated on isSignedIn.
  useListSavedRoutes: () => ({
    data: mocks.isSignedIn ? SERVER_ROUTES : undefined,
    isLoading: false,
    isError: false,
  }),
  useDeleteSavedRoute: () => ({ mutateAsync: mocks.deleteMutate }),
  getSavedRoute: vi.fn(),
  getListSavedRoutesQueryKey: () => ["listSavedRoutes"],
}));

vi.mock("@/lib/localRoutes", () => ({
  // On-device backups are independent of sign-in, so they resolve the same
  // list regardless of auth state.
  listLocalRoutes: () => Promise.resolve(LOCAL_ROUTES),
  getLocalRoute: vi.fn(),
  deleteLocalRoute: vi.fn(() => Promise.resolve()),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: mocks.isSignedIn, signOut: mocks.signOut }),
  useUser: () => ({
    user: mocks.isSignedIn
      ? { primaryEmailAddress: { emailAddress: "rider@example.com" } }
      : null,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/context/RoutePlannerContext", () => ({
  useRoutePlanner: () => ({ loadPlan: mocks.loadPlan }),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, replace: vi.fn(), push: vi.fn() }),
  // Run the focus callback immediately so local backups load on mount.
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require("react").useEffect(cb, [cb]);
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.isSignedIn = true;
  mocks.signOut.mockImplementation(async () => {
    mocks.isSignedIn = false;
  });
  cleanup();
});

describe("SavedRoutesScreen sign-out", () => {
  it("shows the account email when signed in", async () => {
    render(<SavedRoutesScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("account-email").textContent).toBe(
        "rider@example.com",
      ),
    );
  });

  it("hides account routes but keeps local backups after sign-out", async () => {
    // Auto-press the destructive "Afmelden" button in the confirmation alert,
    // since react-native-web's Alert cannot render the native multi-button dialog.
    vi.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
      const confirm = buttons?.find((b) => b.style === "destructive");
      confirm?.onPress?.();
    });

    const { rerender } = render(<SavedRoutesScreen />);

    // Signed in: both the account route and the local backup are visible.
    await waitFor(() =>
      expect(screen.getByTestId("saved-route-Account Rondje")).toBeTruthy(),
    );
    expect(screen.getByTestId("saved-route-Toestel Back-up")).toBeTruthy();
    expect(screen.getByTestId("account-email").textContent).toBe(
      "rider@example.com",
    );

    // Trigger sign-out.
    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["listSavedRoutes"],
    });

    // Re-render to reflect the now signed-out auth state.
    rerender(<SavedRoutesScreen />);

    // Account route is gone; the on-device backup survives.
    await waitFor(() =>
      expect(screen.queryByTestId("saved-route-Account Rondje")).toBeNull(),
    );
    expect(screen.getByTestId("saved-route-Toestel Back-up")).toBeTruthy();
    expect(screen.getByTestId("account-email").textContent).toBe(
      "Niet aangemeld",
    );
  });
});
