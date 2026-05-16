import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Loading skeleton. Per design spec §10, we never use spinners on data
 * surfaces — only skeletons that match the eventual shape of the content.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn("cp-skeleton rounded-xs bg-bg-3", className)}
      aria-hidden="true"
      role="presentation"
      {...props}
    />
  );
}
