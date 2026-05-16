import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
}

/**
 * Filter / facet chip. Used in list-view filter bars.
 *
 * Format: `[icon] label = value`. The value is rendered mono when `mono`
 * is true (typical for MAC / BSSID filters).
 */
export function Chip({
  className,
  icon,
  label,
  value,
  mono = false,
  ...props
}: ChipProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-xs text-fg-80",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="inline-flex size-3 items-center justify-center text-fg-60">{icon}</span>
      )}
      <span className="text-fg-60">{label}</span>
      {value !== undefined && (
        <>
          <span className="text-fg-40">=</span>
          <span className={cn("text-fg-100", mono && "font-mono")}>{value}</span>
        </>
      )}
    </span>
  );
}
