import type { ReactNode } from "react";
import { Glyph } from "@/components/branding/Glyph";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Designed empty state for "no data yet" surfaces. We never show raw
 * "No data" strings (design spec §10).
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 p-8 text-center", className)}
    >
      <Glyph className="size-10 text-fg-40" label="" />
      <h3 className="text-md font-medium text-fg-100">{title}</h3>
      {description && <p className="max-w-prose text-sm text-fg-60">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
