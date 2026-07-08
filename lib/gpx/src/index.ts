export interface GpxWaypoint {
  ref: string;
  lat: number;
  lon: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate a GPX 1.1 document with a single track from route coordinates
 * ([lon, lat] pairs) and optional node waypoints (numbered network nodes).
 */
export function generateGpx(
  coordinates: number[][],
  options: { name?: string; waypoints?: GpxWaypoint[] } = {}
): string {
  const name = options.name?.trim() || "Fietsroute";
  const waypoints = options.waypoints ?? [];

  const wptXml = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat}" lon="${w.lon}">\n    <name>${escapeXml(w.ref)}</name>\n    <sym>Waypoint</sym>\n  </wpt>`
    )
    .join("\n");

  const trkptXml = coordinates
    .map((coord) => `      <trkpt lat="${coord[1]}" lon="${coord[0]}"></trkpt>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fietsrouteplanner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
${wptXml ? wptXml + "\n" : ""}  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkptXml}
    </trkseg>
  </trk>
</gpx>`;
}

/** Safe cross-platform GPX filename from a route name. */
export function gpxFileName(name: string): string {
  const base = name
    .trim()
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .replace(/\s+/g, "_");
  return `${base || "Fietsroute"}.gpx`;
}
