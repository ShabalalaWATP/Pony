import { cn } from "@/lib/cn";

interface WordmarkProps {
  className?: string;
}

/**
 * The CHEEKY PONY wordmark.
 *
 * Static brand mark in Space Grotesk, uppercase, wide tracking. The
 * live-data freshness signal lives on the topbar's
 * `OperatorConnectionPill` — keeping it on the wordmark too was
 * redundant signal and created visual noise on every sidebar refresh.
 */
export function Wordmark({ className }: WordmarkProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-display text-md font-semibold uppercase tracking-[0.18em] text-fg-100",
        className,
      )}
      aria-label="Cheeky Pony"
    >
      <span>cheeky</span>
      <span className="text-mode">pony</span>
    </span>
  );
}
