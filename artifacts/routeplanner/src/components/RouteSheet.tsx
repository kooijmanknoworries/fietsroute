import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";

export interface RouteSheetNode {
  ref: string;
  lat: number;
  lon: number;
}

export interface RouteSheetLeg {
  fromRef: string;
  toRef: string;
  distanceMeters: number;
}

export interface RouteSheetProps {
  name?: string | null;
  nodes: RouteSheetNode[];
  legs: RouteSheetLeg[];
  distanceMeters: number;
  coordinates: number[][];
}

function km(meters: number): string {
  return (meters / 1000).toFixed(1) + " km";
}

// Project [lon, lat] pairs into an SVG viewbox using a simple equirectangular
// projection (x scaled by cos of the mid-latitude so shapes keep roughly the
// right aspect at NL/BE latitudes). Pure SVG prints crisply and needs no tile
// server, so the sheet renders identically on paper and in print preview.
function projectToSvg(
  coordinates: number[][],
  width: number,
  height: number,
  padding: number,
) {
  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const midLat = (minLat + maxLat) / 2;
  const xScaleFactor = Math.cos((midLat * Math.PI) / 180);
  const lonSpan = Math.max((maxLon - minLon) * xScaleFactor, 1e-6);
  const latSpan = Math.max(maxLat - minLat, 1e-6);

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;
  const scale = Math.min(innerW / lonSpan, innerH / latSpan);
  const drawnW = lonSpan * scale;
  const drawnH = latSpan * scale;
  const offsetX = padding + (innerW - drawnW) / 2;
  const offsetY = padding + (innerH - drawnH) / 2;

  return ([lon, lat]: number[]): [number, number] => [
    offsetX + (lon - minLon) * xScaleFactor * scale,
    offsetY + (maxLat - lat) * scale,
  ];
}

// A print-friendly "knooppunter" style route card: node sequence, per-leg
// distances with running totals, and a schematic route map. Used by the print
// action on the planner and by the shared-route page.
export default function RouteSheet({
  name,
  nodes,
  legs,
  distanceMeters,
  coordinates,
}: RouteSheetProps) {
  const { t } = useI18n();

  const width = 720;
  const height = 420;

  const { pathD, nodePoints } = useMemo(() => {
    if (!coordinates.length) return { pathD: "", nodePoints: [] as Array<{ x: number; y: number; ref: string }> };
    const project = projectToSvg(coordinates, width, height, 28);
    const d = coordinates
      .map((c, i) => {
        const [x, y] = project(c);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const points = nodes.map((n) => {
      const [x, y] = project([n.lon, n.lat]);
      return { x, y, ref: n.ref };
    });
    return { pathD: d, nodePoints: points };
  }, [coordinates, nodes]);

  let cumulative = 0;

  return (
    <div className="route-sheet mx-auto max-w-3xl bg-white p-6 text-black" data-testid="route-sheet">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b-2 border-black pb-2">
        <h1 className="text-2xl font-bold">
          {name?.trim() || t("sheet.defaultTitle")}
        </h1>
        <div className="text-right">
          <div className="text-2xl font-bold">{km(distanceMeters)}</div>
          <div className="text-xs text-neutral-600">{t("sheet.totalDistance")}</div>
        </div>
      </div>

      {/* Node sequence ("knooppunter" card) */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          {t("sheet.nodeSequence")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {nodes.map((node, i) => (
            <span key={`${node.ref}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-neutral-400">→</span>}
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-black text-sm font-bold">
                {node.ref}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Legs table */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          {t("sheet.legs")}
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-400 text-left">
              <th className="py-1 pr-2 font-semibold">{t("sheet.leg")}</th>
              <th className="py-1 pr-2 text-right font-semibold">{t("sheet.distance")}</th>
              <th className="py-1 text-right font-semibold">{t("sheet.cumulative")}</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, i) => {
              cumulative += leg.distanceMeters;
              return (
                <tr key={i} className="border-b border-neutral-200">
                  <td className="py-1 pr-2">
                    <span className="font-bold">{leg.fromRef}</span>
                    <span className="mx-1 text-neutral-400">→</span>
                    <span className="font-bold">{leg.toRef}</span>
                  </td>
                  <td className="py-1 pr-2 text-right">{km(leg.distanceMeters)}</td>
                  <td className="py-1 text-right">{km(cumulative)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Schematic route map */}
      {pathD && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
            {t("sheet.map")}
          </h2>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full rounded border border-neutral-300"
            role="img"
            aria-label={t("sheet.map")}
          >
            <rect width={width} height={height} fill="#fafaf7" />
            <path d={pathD} fill="none" stroke="#e11d48" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            {nodePoints.map((p, i) => (
              <g key={`${p.ref}-${i}`}>
                <circle cx={p.x} cy={p.y} r={12} fill="#ffffff" stroke="#111111" strokeWidth={2} />
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={700}
                  fill="#111111"
                >
                  {p.ref}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="mt-4 text-xs text-neutral-500">
        Fietsrouteplanner · {t("sheet.footer")}
      </div>
    </div>
  );
}
