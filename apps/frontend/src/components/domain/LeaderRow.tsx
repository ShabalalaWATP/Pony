import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type LeaderTone = "ok" | "wait" | "fail" | "neutral";

interface LeaderRowProps {
  /** Optional icon shown left of the label. */
  icon?: LucideIcon;
  /** Short uppercase label (e.g. `MTLS LINK`). */
  label: string;
  /** Right-aligned value (e.g. `OK`, `AWAITING`). */
  value: React.ReactNode;
  /** Colour tone for the value. */
  tone?: LeaderTone;
  className?: string;
}

const TONE_CLASS: Record<LeaderTone, string> = {
  ok: "text-accent-green",
  wait: "text-accent-amber",
  fail: "text-accent-red",
  neutral: "text-fg-80",
};

/**
 * One terminal-style "key ……… value" row. The dashed leader between
 * label and value mimics a sysadmin boot log and reinforces the
 * operator-console aesthetic without inventing new chrome each time.
 *
 * Use for short, low-cardinality status lines (≤ 6 per panel). Don't
 * use for data-dense tables — that's what `DataTable` is for.
 */
export function LeaderRow({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  className,
}: LeaderRowProps): JSX.Element {
  return (
    <li
      className={cn("flex items-center gap-2 font-mono text-2xs", className)}
      data-testid="leader-row"
    >
      {Icon && <Icon className="size-3 text-fg-60" aria-hidden="true" />}
      <span className="text-fg-60">{label}</span>
      <span className="flex-1 self-end overflow-hidden text-fg-20" aria-hidden="true">
        ─────────────────────────────
      </span>
      <span className={TONE_CLASS[tone]}>{value}</span>
    </li>
  );
}
