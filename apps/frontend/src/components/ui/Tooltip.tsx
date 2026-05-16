import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Show delay in ms. Defaults to 300ms per design spec §2.4. */
  delayMs?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  className,
  delayMs = 300,
}: TooltipProps): JSX.Element {
  return (
    <RT.Provider delayDuration={delayMs} skipDelayDuration={80}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 max-w-xs rounded-sm border border-fg-20 bg-bg-3 px-2 py-1 text-xs text-fg-100 shadow-lg",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
              "data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0",
              className,
            )}
          >
            {content}
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  );
}
