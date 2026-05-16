import { useLivePulse } from "@/hooks/useLivePulse";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/cn";

interface WordmarkProps {
  className?: string;
  /** Timestamp of the most recent event from the active sensor. */
  lastEventAt?: Date | number | null;
  /** Force a pulse state regardless of `lastEventAt`. Useful in storybook/tests. */
  forceState?: "live" | "stale";
}

/**
 * The CHEEKY//PONY wordmark.
 *
 * Per design spec §1, the `//` is a live-pulse indicator: it pulses cyan
 * (or violet in lab mode, inherited from `--mode-accent`) only when the
 * active sensor has emitted an event in the last 5 seconds. Stale data
 * collapses the `//` to a flat dim slate. Reduced-motion users get the
 * fresh-state colour without the pulse animation.
 */
export function Wordmark({ className, lastEventAt, forceState }: WordmarkProps): JSX.Element {
  const fresh = useLivePulse(lastEventAt);
  const reducedMotion = useReducedMotion();

  const isLive = forceState ? forceState === "live" : fresh;
  const animate = isLive && !reducedMotion;

  return (
    <span
      className={cn(
        "inline-flex items-center font-display text-md font-semibold uppercase tracking-[0.12em] text-fg-100",
        className,
      )}
      aria-label="Cheeky Pony"
    >
      <span>cheeky</span>
      <span
        aria-hidden="true"
        className={cn(
          "mx-1 select-none transition-colors duration-base",
          isLive ? "text-mode" : "text-fg-20",
          animate && "cp-live-pulse",
        )}
      >
        //
      </span>
      <span>pony</span>
    </span>
  );
}
