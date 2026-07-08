import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { generateGpx, gpxFileName, type GpxWaypoint } from "@workspace/gpx";

export interface GpxExportInput {
  coordinates: number[][];
  name?: string;
  waypoints?: GpxWaypoint[];
}

/**
 * Generate a GPX file for the given route and open the native share sheet.
 * On web (dev preview) falls back to a browser download.
 */
export async function exportRouteAsGpx({
  coordinates,
  name = "Fietsroute",
  waypoints = [],
}: GpxExportInput): Promise<void> {
  if (!coordinates || coordinates.length === 0) {
    throw new Error("Geen route om te exporteren");
  }

  const gpx = generateGpx(coordinates, { name, waypoints });
  const fileName = gpxFileName(name);

  if (Platform.OS === "web") {
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(gpx);

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Delen is niet beschikbaar op dit toestel");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/gpx+xml",
    dialogTitle: `${name} delen als GPX`,
    UTI: "com.topografix.gpx",
  });
}
