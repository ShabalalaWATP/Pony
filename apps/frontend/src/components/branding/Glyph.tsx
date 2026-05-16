import { cn } from "@/lib/cn";

interface GlyphProps {
  className?: string;
  /** Accessible label. Pass an empty string for purely decorative usage. */
  label?: string;
  /** Hide the second (outer) sweep arc — useful at 16px where it looks crowded. */
  compact?: boolean;
}

/**
 * Cheeky Pony glyph — a "tracking diamond" with RF sweep arcs.
 *
 * Renders at the parent's font-size by default (1em square). Pass `size-N`
 * utility classes to lock it to a specific dimension. Always uses
 * `currentColor` so the colour follows surrounding text.
 */
export function Glyph({
  className,
  label = "Cheeky Pony",
  compact = false,
}: GlyphProps): JSX.Element {
  const decorative = label.length === 0;

  return (
    <svg
      className={cn("inline-block size-[1em] shrink-0", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {/* Tracking diamond with notched right corner */}
      <path d="M12 3L18 10L16.5 12L18 14L12 21L5 12Z" />
      {/* Inner RF sweep */}
      <path d="M19.5 10.5A1.5 1.5 0 0 1 19.5 13.5" />
      {/* Outer RF sweep — dropped in compact mode */}
      {!compact && <path d="M21 9.5A3 3 0 0 1 21 14.5" opacity={0.65} />}
    </svg>
  );
}
