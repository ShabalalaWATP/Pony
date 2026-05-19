import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Keyboard shortcut indicator. Use for hotkey hints in tooltips, the
 * command palette, and the `?` cheat sheet.
 */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>): JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-fg-20 bg-bg-2 px-1 font-mono text-2xs text-fg-60",
        className,
      )}
      {...props}
    />
  );
}
