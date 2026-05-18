import { Bell, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/Separator";
import { UserMenu } from "@/components/auth/UserMenu";
import { Breadcrumbs } from "./Breadcrumbs";
import { OperatorConnectionPill } from "./OperatorConnectionPill";
import { useUIStore } from "@/stores/useUIStore";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { cn } from "@/lib/cn";

export function Topbar(): JSX.Element {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openPalette = useUIStore((s) => s.openCommandPalette);
  const labPreview = useLabModeStore((s) => s.preview);

  const PanelIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header
      className={cn(
        "relative flex h-12 shrink-0 items-center gap-3 border-b border-fg-20 bg-bg-3 px-4",
        labPreview && "border-b-2 border-b-accent-violet",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <PanelIcon className="size-4" aria-hidden="true" />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={openPalette}
          className="inline-flex h-7 items-center gap-2 rounded-sm border border-fg-20 bg-bg-2 px-2 text-xs text-fg-60 hover:text-fg-100"
          aria-label="Open command palette"
        >
          <Search className="size-3" aria-hidden="true" />
          <span>Jump to…</span>
          <Kbd className="ml-2">⌘K</Kbd>
        </button>

        <OperatorConnectionPill />

        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-4" aria-hidden="true" />
        </Button>
        <UserMenu />
      </div>

      <div className="cp-scanline" aria-hidden="true" />
    </header>
  );
}
