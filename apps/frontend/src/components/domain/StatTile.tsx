import type { ReactNode } from "react";
import { EndpointHint } from "@/components/ui/EndpointHint";
import { cn } from "@/lib/cn";
import { SignalSparkline } from "./SignalSparkline";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Optional sparkline tucked into the bottom-right corner. */
  trend?: readonly number[];
  /** Delta vs previous period (positive number = up). */
  delta?: number;
  /** Backend route this tile sources its value from (e.g. `/api/v1/sensors`). */
  endpoint?: string;
  className?: string;
}

/**
 * KPI tile. Per design spec §6 the overview is six tiles tall; this is
 * the cell. Anatomy: label (top, uppercase), big mono value (centre),
 * delta + sparkline (bottom). Click-through is handled by the caller.
 */
export function StatTile({
  label,
  value,
  trend,
  delta,
  endpoint,
  className,
}: StatTileProps): JSX.Element {
  return (
    <div
      className={cn(
        "relative flex h-26 flex-col justify-between rounded-md border border-fg-20 bg-bg-2 p-4",
        "shadow-[inset_0_1px_0_hsl(220_14%_98%/0.03)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wide text-fg-60">{label}</span>
        {endpoint && <EndpointHint className="truncate">{endpoint}</EndpointHint>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-mono text-2xl tabular-nums text-fg-100">{value}</div>
        <div className="flex flex-col items-end gap-1">
          {delta !== undefined && (
            <span
              className={cn(
                "font-mono text-2xs tabular-nums",
                delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-red" : "text-fg-60",
              )}
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          )}
          {trend && trend.length > 0 && (
            <SignalSparkline samples={trend} width={60} height={18} tone="mode" />
          )}
        </div>
      </div>
    </div>
  );
}
