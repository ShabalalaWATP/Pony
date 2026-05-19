import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export function Separator({
  orientation = "horizontal",
  className,
  ...props
}: SeparatorProps): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-fg-20",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
