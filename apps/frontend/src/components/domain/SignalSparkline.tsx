import { useId, useMemo } from "react";
import { cn } from "@/lib/cn";

interface SignalSparklineProps {
  /** Series of dBm samples, oldest → newest. */
  samples: readonly number[];
  width?: number;
  height?: number;
  className?: string;
  /** Plot stroke + area gradient — defaults to the current `--mode-accent`. */
  tone?: "mode" | "green" | "amber" | "red";
}

const TONE_TO_VAR: Record<NonNullable<SignalSparklineProps["tone"]>, string> = {
  mode: "var(--color-mode)",
  green: "var(--color-accent-green)",
  amber: "var(--color-accent-amber)",
  red: "var(--color-accent-red)",
};

/**
 * Compact dBm sparkline (default 80×24). No axes, no tooltip — for use in
 * lists and KPI tiles where you want a sense of trend at a glance.
 */
export function SignalSparkline({
  samples,
  width = 80,
  height = 24,
  className,
  tone = "mode",
}: SignalSparklineProps): JSX.Element {
  const gradientId = useId();
  const colour = TONE_TO_VAR[tone];

  const { linePath, areaPath } = useMemo(() => {
    if (samples.length === 0) return { linePath: "", areaPath: "" };

    // Anchor the range to plausible RSSI bounds so identical-value series
    // still render a flat line at a sensible height rather than top-of-canvas.
    const min = -100;
    const max = -30;
    const span = max - min;

    const dx = samples.length > 1 ? width / (samples.length - 1) : 0;
    const points = samples.map((s, i) => {
      const clamped = Math.max(min, Math.min(max, s));
      const y = height - ((clamped - min) / span) * height;
      return { x: i * dx, y };
    });

    const lineSegments = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
    const areaSegments = `${lineSegments} L${width},${height} L0,${height} Z`;
    return { linePath: lineSegments, areaPath: areaSegments };
  }, [samples, width, height]);

  if (samples.length === 0) {
    return (
      <svg className={cn("text-fg-40", className)} width={width} height={height} aria-hidden="true">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  return (
    <svg
      className={cn("overflow-visible", className)}
      width={width}
      height={height}
      role="img"
      aria-label={`Signal trend, ${samples.length} samples`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.35} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={colour} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}
