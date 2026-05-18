import { cn } from "@/lib/cn";

interface CornerBracketsProps {
  /** Negative inset for the bracket overlay; passes through to the wrapper. */
  inset?: string;
  /** Bracket stroke width in pixels (default 2). */
  weight?: 1 | 2;
  /** Visual tone — defaults to the mode accent (cyan, violet in lab mode). */
  tone?: "mode" | "amber" | "red" | "fg-40";
  /** Extra wrapper class names (e.g. positioning context for the parent). */
  className?: string;
}

const TONE_COLOR: Record<NonNullable<CornerBracketsProps["tone"]>, string> = {
  mode: "hsl(var(--mode-accent))",
  amber: "hsl(var(--accent-amber))",
  red: "hsl(var(--accent-red))",
  "fg-40": "hsl(var(--fg-40))",
};

/**
 * Four absolute-positioned L-shape brackets that frame the parent
 * element. Purely decorative — use sparingly to flag panels that
 * carry weight (high-stakes destructive actions, the active-engagement
 * lab panel, the login form). Putting brackets on everything dilutes
 * the signal, so resist the urge.
 *
 * The parent MUST be `position: relative` or this won't anchor.
 */
export function CornerBrackets({
  inset = "-0.5rem",
  weight = 2,
  tone = "mode",
  className,
}: CornerBracketsProps): JSX.Element {
  const borderColor = TONE_COLOR[tone];
  const armSize = weight === 2 ? "size-3.5" : "size-3";
  const widthClass = weight === 2 ? "" : "";
  const borderStyle = { borderColor, borderWidth: `${weight}px` };
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
      style={{ inset }}
    >
      <span
        className={cn("absolute left-0 top-0 border-l border-t", armSize, widthClass)}
        style={borderStyle}
      />
      <span
        className={cn("absolute right-0 top-0 border-r border-t", armSize, widthClass)}
        style={borderStyle}
      />
      <span
        className={cn("absolute bottom-0 left-0 border-b border-l", armSize, widthClass)}
        style={borderStyle}
      />
      <span
        className={cn("absolute bottom-0 right-0 border-b border-r", armSize, widthClass)}
        style={borderStyle}
      />
    </div>
  );
}
