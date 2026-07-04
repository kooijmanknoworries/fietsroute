import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import {
  RoutePlannerProvider,
  useRoutePlanner,
  type NetworkNode,
  type RoutePlan,
} from "@/context/RoutePlannerContext";
import SaveRouteModal from "./SaveRouteModal";

// --- Mocks -----------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  planRoute: vi.fn(),
  mutateAsync: vi.fn(),
  saveLocalRoute: vi.fn(),
  invalidateQueries: vi.fn(),
  isSignedIn: true as boolean,
  push: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  planRoute: (...args: unknown[]) => mocks.planRoute(...args),
  useSaveRoute: () => ({ mutateAsync: mocks.mutateAsync }),
  getListSavedRoutesQueryKey: () => ["listSavedRoutes"],
}));

vi.mock("@/lib/localRoutes", () => ({
  saveLocalRoute: (...args: unknown[]) => mocks.saveLocalRoute(...args),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: mocks.isSignedIn }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

// --- Fixtures --------------------------------------------------------------

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };

function makePlan(): RoutePlan {
  return {
    nodeRefs: ["63", "08"],
    coordinates: [
      [5.0, 52.0],
      [5.01, 52.01],
    ],
    distanceMeters: 4200,
    legs: [
      {
        fromRef: "63",
        toRef: "08",
        distanceMeters: 4200,
        coordinates: [
          [5.0, 52.0],
          [5.01, 52.01],
        ],
      },
    ],
  };
}

// Seeds the shared context with a two-node planned route so the modal has
// something to save.
function Seeder() {
  const { addNode } = useRoutePlanner();
  return (
    <button
      data-testid="seed"
      onClick={() => {
        addNode(NODE_A);
        addNode(NODE_B);
      }}
    >
      seed
    </button>
  );
}

function Harness() {
  return (
    <RoutePlannerProvider>
      <Seeder />
      <SaveRouteModal visible onClose={() => {}} />
    </RoutePlannerProvider>
  );
}

const EXPECTED_PAYLOAD = {
  name: "Rondje Veluwe",
  nodes: [
    { id: "1", ref: "63", lat: 52.0, lon: 5.0 },
    { id: "2", ref: "08", lat: 52.01, lon: 5.01 },
  ],
  plan: makePlan(),
};

async function seedAndName() {
  mocks.planRoute.mockResolvedValue(makePlan());
  render(<Harness />);
  fireEvent.click(screen.getByTestId("seed"));
  // Wait for the route to be planned so handleSave has a routePlan to persist.
  await waitFor(() => expect(mocks.planRoute).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("save-route-name"), {
    target: { value: "Rondje Veluwe" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.isSignedIn = true;
  cleanup();
});

describe("SaveRouteModal", () => {
  it("signed-in: writes a local backup and calls the /api/routes mutation", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "srv_1" });
    await seedAndName();

    fireEvent.click(screen.getByTestId("save-route-confirm"));

    await waitFor(() =>
      expect(screen.getByText("Route opgeslagen")).toBeTruthy(),
    );

    // On-device backup is always written first.
    expect(mocks.saveLocalRoute).toHaveBeenCalledWith(EXPECTED_PAYLOAD);
    // Signed-in save also persists to the account.
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ data: EXPECTED_PAYLOAD });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["listSavedRoutes"],
    });
  });

  it("signed-out: writes only the local backup, no account mutation", async () => {
    mocks.isSignedIn = false;
    await seedAndName();

    fireEvent.click(screen.getByTestId("save-route-confirm"));

    await waitFor(() => expect(screen.getByText("Lokaal bewaard")).toBeTruthy());

    expect(mocks.saveLocalRoute).toHaveBeenCalledWith(EXPECTED_PAYLOAD);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the local backup even when the account save fails", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("network down"));
    await seedAndName();

    fireEvent.click(screen.getByTestId("save-route-confirm"));

    await waitFor(() =>
      expect(
        screen.getByText(/Opslaan naar je account is mislukt/),
      ).toBeTruthy(),
    );

    // Backup was still written despite the account failure.
    expect(mocks.saveLocalRoute).toHaveBeenCalledWith(EXPECTED_PAYLOAD);
    expect(mocks.mutateAsync).toHaveBeenCalled();
  });

  it("does not save when no name is entered", async () => {
    mocks.planRoute.mockResolvedValue(makePlan());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("seed"));
    await waitFor(() => expect(mocks.planRoute).toHaveBeenCalled());

    // Confirm without typing a name — nothing should be persisted.
    fireEvent.click(screen.getByTestId("save-route-confirm"));

    expect(mocks.saveLocalRoute).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
