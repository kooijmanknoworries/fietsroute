import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2, TrendingUp, ArrowUp, ArrowDown, Mountain } from "lucide-react";
import { getElevationProfile } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";

interface ElevationProfileProps {
  coordinates: number[][];
}

function routeKey(coordinates: number[][]): string {
  // Compact stable key: endpoints + length + a few midpoints.
  const pick = (i: number) => coordinates[i]?.join(",") ?? "";
  const mid = Math.floor(coordinates.length / 2);
  return [
    coordinates.length,
    pick(0),
    pick(mid),
    pick(coordinates.length - 1),
  ].join("|");
}

export default function ElevationProfile({ coordinates }: ElevationProfileProps) {
  const { t } = useI18n();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["elevation-profile", routeKey(coordinates)],
    queryFn: () => getElevationProfile({ coordinates }),
    enabled: coordinates.length >= 2,
    staleTime: Infinity,
    retry: 1,
  });

  if (coordinates.length < 2) return null;

  return (
    <div className="space-y-2" data-testid="elevation-profile">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Mountain className="h-4 w-4" /> {t("elevation.title")}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("elevation.loading")}
        </div>
      )}

      {isError && (
        <p className="py-2 text-sm text-muted-foreground">{t("elevation.error")}</p>
      )}

      {data && (
        <>
          <div className="h-32 w-full" data-testid="elevation-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.points.map((p) => ({
                  km: p.distanceMeters / 1000,
                  elevation: p.elevationMeters,
                }))}
                margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="elevationFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="km"
                  type="number"
                  domain={[0, "dataMax"]}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  tick={{ fontSize: 10 }}
                  unit=" km"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={32}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                  domain={["auto", "auto"]}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number) => [`${Math.round(value)} m`, ""]}
                  labelFormatter={(label: number) => `${label.toFixed(1)} km`}
                  separator=""
                />
                <Area
                  type="monotone"
                  dataKey="elevation"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  fill="url(#elevationFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-secondary/50 p-2" data-testid="elevation-ascent">
              <div className="flex items-center gap-1 text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> {t("elevation.ascent")}
              </div>
              <div className="font-semibold text-foreground">
                {Math.round(data.ascentMeters)} m
              </div>
            </div>
            <div className="rounded-md bg-secondary/50 p-2" data-testid="elevation-highest">
              <div className="flex items-center gap-1 text-muted-foreground">
                <ArrowUp className="h-3 w-3" /> {t("elevation.highest")}
              </div>
              <div className="font-semibold text-foreground">
                {Math.round(data.maxElevationMeters)} m
              </div>
            </div>
            <div className="rounded-md bg-secondary/50 p-2" data-testid="elevation-lowest">
              <div className="flex items-center gap-1 text-muted-foreground">
                <ArrowDown className="h-3 w-3" /> {t("elevation.lowest")}
              </div>
              <div className="font-semibold text-foreground">
                {Math.round(data.minElevationMeters)} m
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
