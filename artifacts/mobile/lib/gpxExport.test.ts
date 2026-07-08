import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import { generateGpx, gpxFileName } from "@workspace/gpx";

const fsState = vi.hoisted(() => ({
  written: [] as Array<{ name: string; content: string }>,
  shareCalls: [] as Array<{ uri: string; options: unknown }>,
  sharingAvailable: true,
}));

vi.mock("expo-file-system", () => {
  class MockFile {
    name: string;
    exists = false;
    constructor(_dir: string, name: string) {
      this.name = name;
    }
    get uri() {
      return `file:///cache/${this.name}`;
    }
    create() {
      this.exists = true;
    }
    delete() {
      this.exists = false;
    }
    write(content: string) {
      fsState.written.push({ name: this.name, content });
    }
  }
  return { File: MockFile, Paths: { cache: "/cache" } };
});

vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => fsState.sharingAvailable,
  shareAsync: async (uri: string, options: unknown) => {
    fsState.shareCalls.push({ uri, options });
  },
}));

import { exportRouteAsGpx } from "./gpxExport";

const COORDS = [
  [5.0, 52.0],
  [5.01, 52.01],
  [5.02, 52.02],
];
const WAYPOINTS = [
  { ref: "63", lat: 52.0, lon: 5.0 },
  { ref: "08", lat: 52.02, lon: 5.02 },
];

const originalOS = Platform.OS;

beforeEach(() => {
  // Force the native code path (react-native-web reports "web" under jsdom).
  (Platform as { OS: string }).OS = "ios";
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  fsState.written = [];
  fsState.shareCalls = [];
  fsState.sharingAvailable = true;
});

describe("generateGpx", () => {
  it("produces valid GPX 1.1 with track points and node waypoints", () => {
    const gpx = generateGpx(COORDS, { name: "Ronde <A&B>", waypoints: WAYPOINTS });

    // Parses as XML (jsdom DOMParser) with no parsererror.
    const doc = new DOMParser().parseFromString(gpx, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();

    const root = doc.documentElement;
    expect(root.tagName).toBe("gpx");
    expect(root.getAttribute("version")).toBe("1.1");
    expect(root.getAttribute("xmlns")).toBe("http://www.topografix.com/GPX/1/1");

    const trkpts = doc.querySelectorAll("trkseg > trkpt");
    expect(trkpts.length).toBe(3);
    expect(trkpts[0].getAttribute("lat")).toBe("52");
    expect(trkpts[0].getAttribute("lon")).toBe("5");

    const wpts = doc.querySelectorAll("wpt");
    expect(wpts.length).toBe(2);
    expect(wpts[0].querySelector("name")?.textContent).toBe("63");
    expect(wpts[1].getAttribute("lat")).toBe("52.02");

    // Name is escaped, and survives round-trip.
    expect(doc.querySelector("trk > name")?.textContent).toBe("Ronde <A&B>");
  });

  it("sanitizes filenames", () => {
    expect(gpxFileName("Ronde om de Plas / 2026")).toBe("Ronde_om_de_Plas_2026.gpx");
    expect(gpxFileName("   ")).toBe("Fietsroute.gpx");
  });
});

describe("exportRouteAsGpx (native)", () => {
  it("writes the GPX file and opens the share sheet", async () => {
    await exportRouteAsGpx({ coordinates: COORDS, name: "Mijn route", waypoints: WAYPOINTS });

    expect(fsState.written.length).toBe(1);
    expect(fsState.written[0].name).toBe("Mijn_route.gpx");
    expect(fsState.written[0].content).toContain("<trkpt lat=\"52\" lon=\"5\">");
    expect(fsState.written[0].content).toContain("<wpt lat=\"52.02\" lon=\"5.02\">");

    expect(fsState.shareCalls.length).toBe(1);
    expect(fsState.shareCalls[0].uri).toBe("file:///cache/Mijn_route.gpx");
    expect(fsState.shareCalls[0].options).toMatchObject({
      mimeType: "application/gpx+xml",
      UTI: "com.topografix.gpx",
    });
  });

  it("throws when there is nothing to export", async () => {
    await expect(exportRouteAsGpx({ coordinates: [] })).rejects.toThrow(
      "Geen route om te exporteren"
    );
    expect(fsState.shareCalls.length).toBe(0);
  });

  it("throws when sharing is unavailable", async () => {
    fsState.sharingAvailable = false;
    await expect(exportRouteAsGpx({ coordinates: COORDS })).rejects.toThrow(
      "Delen is niet beschikbaar"
    );
    expect(fsState.shareCalls.length).toBe(0);
  });
});
