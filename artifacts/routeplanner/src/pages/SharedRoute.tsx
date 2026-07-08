import { useEffect, useRef } from "react";
import { Link, useRoute } from "wouter";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, MapIcon, Printer, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useGetSharedRoute,
  getGetSharedRouteQueryKey,
} from "@workspace/api-client-react";
import type { SharedRoute as SharedRouteData } from "@workspace/api-client-react";
import RouteSheet from "@/components/RouteSheet";
import { useI18n } from "@/lib/i18n";

// Read-only interactive map for a shared route: light basemap, the route line,
// and the numbered knooppunten. Deliberately independent of the planner's Map
// component — no network layer, no clicking, no auth.
function SharedRouteMap({ route }: { route: SharedRouteData }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const coords = route.plan.coordinates as [number, number][];
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: {
          version: 8,
          glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
          sources: {
            street: {
              type: "raster",
              tiles: ["a", "b", "c", "d"].map(
                (sub) =>
                  `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`,
              ),
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            },
          },
          layers: [{ id: "street-layer", type: "raster", source: "street" }],
        },
        bounds,
        fitBoundsOptions: { padding: 60 },
        attributionControl: { compact: true },
      });
    } catch {
      // Environments without WebGL simply skip the interactive map; the
      // printable sheet below still shows the schematic route.
      return;
    }

    map.on("load", () => {
      map.addSource("shared-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      });
      map.addLayer({
        id: "shared-route-layer",
        type: "line",
        source: "shared-route",
        paint: { "line-color": "#e11d48", "line-width": 5, "line-opacity": 0.9 },
        layout: { "line-join": "round", "line-cap": "round" },
      });

      map.addSource("shared-nodes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: route.nodes.map((n) => ({
            type: "Feature" as const,
            properties: { ref: n.ref },
            geometry: { type: "Point" as const, coordinates: [n.lon, n.lat] },
          })),
        },
      });
      map.addLayer({
        id: "shared-nodes-circle",
        type: "circle",
        source: "shared-nodes",
        paint: {
          "circle-radius": 12,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#111111",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "shared-nodes-text",
        type: "symbol",
        source: "shared-nodes",
        layout: {
          "text-field": ["get", "ref"],
          "text-font": ["Open Sans Regular"],
          "text-size": 12,
        },
        paint: { "text-color": "#111111" },
      });
    });

    return () => {
      map.remove();
    };
  }, [route]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full overflow-hidden rounded-lg border border-border"
      data-testid="shared-route-map"
    />
  );
}

// Public page for a shared route link: /shared/:token. No sign-in required —
// the API endpoint is public and this page never touches authed queries.
export default function SharedRoutePage() {
  const [, params] = useRoute("/shared/:token");
  const token = params?.token ?? "";
  const { t } = useI18n();

  const { data: route, isLoading, isError } = useGetSharedRoute(token, {
    query: {
      queryKey: getGetSharedRouteQueryKey(token),
      enabled: !!token,
      retry: false,
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="no-print border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5" />
            <span className="font-bold">Fietsrouteplanner</span>
            <span className="text-sm opacity-80">· {t("shared.title")}</span>
          </div>
          <div className="flex items-center gap-2">
            {route && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.print()}
                data-testid="shared-print"
              >
                <Printer className="mr-2 h-4 w-4" /> {t("print.button")}
              </Button>
            )}
            <Link href={route ? `/?shared=${token}` : "/"}>
              <Button
                size="sm"
                variant="outline"
                className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10"
                data-testid="shared-open-planner"
                onClick={() => {
                  // Stash the token so the route still loads if the planner
                  // forces a sign-in redirect (which drops query params).
                  if (route) {
                    try {
                      sessionStorage.setItem("fiets-shared-token", token);
                    } catch {
                      // Query param fallback still applies.
                    }
                  }
                }}
              >
                {t("shared.openPlanner")}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {isLoading && (
          <div className="no-print flex items-center gap-2 py-16 justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("shared.loading")}
          </div>
        )}

        {isError && (
          <Alert variant="destructive" className="no-print">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("shared.notFoundTitle")}</AlertTitle>
            <AlertDescription>{t("shared.notFoundDesc")}</AlertDescription>
          </Alert>
        )}

        {route && (
          <>
            <div className="no-print">
              <SharedRouteMap route={route} />
            </div>
            <RouteSheet
              name={route.name}
              nodes={route.nodes}
              legs={route.plan.legs}
              distanceMeters={route.plan.distanceMeters}
              coordinates={route.plan.coordinates}
            />
          </>
        )}
      </div>
    </div>
  );
}
