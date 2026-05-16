import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/cn";

type LiveDotState = "live" | "stale" | "offline";

interface LiveDotProps {
  state: LiveDotState;
  label?: string;
  className?: string;
}

const STATE_CLASSES: Record<LiveDotState, { dot: string; text: string }> = {
  live: { dot: "bg-accent-green", text: "text-accent-green" },
  stale: { dot: "bg-accent-amber", text: "text-accent-amber" },
  offline: { dot: "bg-fg-40", text: "text-fg-60" },
};

const STATE_LABELS: Record<LiveDotState, string> = {
  live: "Live",
  stale: "Stale",
  offline: "Offline",
};

/**
 * Status indicator dot + (optional) label.
 *
 * Pulses cyan when `state === "live"` and the user hasn't requested reduced
 * motion. Stale and offline are static. Per design spec §9, freshness is
 * computed upstream (see `useLivePulse`) — this component only renders.
 */
export function LiveDot({ state, label, className }: LiveDotProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const displayLabel = label ?? STATE_LABELS[state];
  const cls = STATE_CLASSES[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide",
        cls.text,
        className,
      )}
    >
      <span className="relative inline-flex">
        <span className={cn("size-2 rounded-full", cls.dot)} aria-hidden="true" />
        {state === "live" && !reducedMotion && (
          <span
            aria-hidden="true"
            className={cn("absolute inset-0 size-2 rounded-full cp-live-pulse", cls.dot)}
          />
        )}
      </span>
      <span aria-live={state === "live" ? "polite" : undefined}>{displayLabel}</span>
    </span>
  );
}
