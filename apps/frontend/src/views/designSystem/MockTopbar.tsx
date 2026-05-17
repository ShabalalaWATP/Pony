import { Bell, Search, Settings } from "lucide-react";
import { Glyph } from "@/components/branding/Glyph";
import { Wordmark } from "@/components/branding/Wordmark";
import { LiveDot } from "@/components/domain/LiveDot";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/Separator";
import { cn } from "@/lib/cn";

/**
 * Static, non-functional topbar shown above the design-system showcase.
 * Demonstrates the chrome treatment (glyph + wordmark, breadcrumb, ⌘K
 * pill, live indicator, action icons) and the lab-mode violet underline.
 */
export function MockTopbar({ labMode }: { labMode: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        "relative flex h-12 items-center gap-4 border-b border-fg-20 bg-bg-3 px-4",
        labMode && "border-b-2 border-b-accent-violet",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Glyph className="size-6 text-mode" label="" />
        <Wordmark forceState="live" />
      </div>
      <Separator orientation="vertical" className="mx-2 h-5" />
      <nav className="font-mono text-xs text-fg-60">
        <span>Sensors</span>
        <span className="mx-1.5 text-fg-40">/</span>
        <span className="text-fg-100">wlan-pi-01</span>
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-2 rounded-sm border border-fg-20 bg-bg-2 px-2 text-xs text-fg-60 hover:text-fg-100"
        >
          <Search className="size-3" aria-hidden="true" />
          <span>Jump to…</span>
          <Kbd className="ml-2">⌘K</Kbd>
        </button>
        <div className="flex items-center gap-2 text-fg-60">
          <LiveDot state="live" label="5 sensors · 1.2k/min" />
        </div>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="cp-scanline" aria-hidden="true" />
    </div>
  );
}
