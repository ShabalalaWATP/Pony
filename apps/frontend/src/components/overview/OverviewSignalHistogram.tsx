import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/domain/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { latestRssi } from "@/lib/signal-helpers";
import { useAccessPointsList, type AccessPoint } from "@/services/api/queries";

/**
 * Signal-strength bands in dBm. AP latest-RSSI is bucketed into these
 * ranges for the histogram. Lower-bound inclusive, upper-bound exclusive.
 */
const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "−95…−85", lo: -95, hi: -85 },
  { label: "−85…−75", lo: -85, hi: -75 },
  { label: "−75…−65", lo: -75, hi: -65 },
  { label: "−65…−55", lo: -65, hi: -55 },
  { label: "−55…−30", lo: -55, hi: -30 },
];

interface ChartDatum {
  label: string;
  count: number;
}

function bucket(aps: AccessPoint[]): ChartDatum[] {
  const counts = new Map<string, number>(BUCKETS.map((b) => [b.label, 0]));
  for (const ap of aps) {
    const rssi = latestRssi(ap);
    if (rssi === null) continue;
    for (const b of BUCKETS) {
      if (rssi >= b.lo && rssi < b.hi) {
        counts.set(b.label, (counts.get(b.label) ?? 0) + 1);
        break;
      }
    }
  }
  return BUCKETS.map((b) => ({ label: b.label, count: counts.get(b.label) ?? 0 }));
}

export function OverviewSignalHistogram(): JSX.Element {
  const aps = useAccessPointsList({ limit: 500 });
  const data = useMemo(() => bucket(aps.data?.items ?? []), [aps.data?.items]);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="overflow-hidden rounded-md border border-fg-20 bg-bg-2">
      <div className="flex items-center justify-between border-b border-fg-20 px-4 py-2.5">
        <div className="text-2xs uppercase tracking-wide text-fg-60">AP signal distribution</div>
        <div className="font-mono text-2xs text-fg-60">n={total}</div>
      </div>
      <div className="p-4">
        {aps.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : total === 0 ? (
          <EmptyState
            title="No signal samples yet"
            description="Histogram populates once your sensors have observed access points with measured RSSI."
          />
        ) : (
          <div className="h-40 w-full" data-testid="signal-histogram">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid
                  stroke="hsl(220 8% 42% / 0.18)"
                  strokeDasharray="2 2"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="hsl(220 10% 62%)"
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="hsl(220 10% 62%)"
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <RechartsTooltip
                  cursor={{ fill: "hsl(220 14% 10% / 0.4)" }}
                  contentStyle={{
                    background: "hsl(220 12% 14%)",
                    border: "1px solid hsl(220 6% 22%)",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(220 14% 98%)" }}
                  itemStyle={{ color: "hsl(220 14% 98%)" }}
                />
                <Bar dataKey="count" fill="var(--color-mode)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
