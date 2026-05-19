import { cn } from "@/lib/cn";

interface SignalBarsProps {
  /** RSSI in dBm (typical range: -100 weakest … -30 strongest). */
  dbm: number;
  showValue?: boolean;
  className?: string;
}

/**
 * Pick a bar count (0–4) and a colour from an RSSI value.
 * The thresholds match common WiFi quality buckets.
 */
function classify(dbm: number): { bars: 0 | 1 | 2 | 3 | 4; tone: string; label: string } {
  if (dbm >= -55) return { bars: 4, tone: "text-accent-green", label: "excellent" };
  if (dbm >= -65) return { bars: 3, tone: "text-accent-green", label: "good" };
  if (dbm >= -75) return { bars: 2, tone: "text-accent-amber", label: "fair" };
  if (dbm >= -85) return { bars: 1, tone: "text-accent-amber", label: "weak" };
  return { bars: 0, tone: "text-accent-red", label: "very weak" };
}

const BAR_HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5"] as const;

/**
 * 0–4 vertical signal bars with an optional dBm value.
 *
 * Colour-blind safety: paired with the dBm label by default so the colour
 * is never the only signal (per design spec §11).
 */
export function SignalBars({ dbm, showValue = true, className }: SignalBarsProps): JSX.Element {
  const { bars, tone, label } = classify(dbm);
  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5", tone, className)}
      aria-label={`Signal ${label}, ${dbm} dBm`}
    >
      <span className="flex items-end gap-px" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "w-1 rounded-xs",
              BAR_HEIGHTS[i],
              i < bars ? "bg-current" : "bg-current opacity-20",
            )}
          />
        ))}
      </span>
      {showValue && <span className="font-mono text-2xs tabular-nums">{dbm} dBm</span>}
    </span>
  );
}
