import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Beaker,
  Bell,
  Command as CommandIcon,
  FileText,
  Keyboard,
  type LucideIcon,
  Map as MapIcon,
  PanelLeftClose,
  Radar,
  Router as RouterIcon,
  Settings,
  ShieldAlert,
  Smartphone,
  Wifi,
} from "lucide-react";
import { useEffect } from "react";
import { useUIStore } from "@/stores/useUIStore";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  Icon: LucideIcon;
  group: "Navigate" | "Verbs" | "Lab";
  perform: (ctx: PaletteContext) => void;
}

interface PaletteContext {
  navigate: ReturnType<typeof useNavigate>;
  ui: ReturnType<typeof useUIStore.getState>;
  lab: ReturnType<typeof useLabModeStore.getState>;
  close: () => void;
}

const ITEMS: PaletteItem[] = [
  {
    id: "go-overview",
    label: "Go to Overview",
    hint: "g o",
    Icon: Activity,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/" });
      close();
    },
  },
  {
    id: "go-sensors",
    label: "Go to Sensors",
    hint: "g s",
    Icon: RouterIcon,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/sensors" });
      close();
    },
  },
  {
    id: "go-networks",
    label: "Go to Networks",
    hint: "g n",
    Icon: Wifi,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/networks" });
      close();
    },
  },
  {
    id: "go-devices",
    label: "Go to Devices",
    hint: "g d",
    Icon: Smartphone,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/devices" });
      close();
    },
  },
  {
    id: "go-events",
    label: "Go to Events",
    hint: "g e",
    Icon: FileText,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/events" });
      close();
    },
  },
  {
    id: "go-alerts",
    label: "Go to Alerts",
    hint: "g a",
    Icon: Bell,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/alerts" });
      close();
    },
  },
  {
    id: "go-map",
    label: "Go to Map",
    Icon: MapIcon,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/map" });
      close();
    },
  },
  {
    id: "go-engagements",
    label: "Go to Engagements",
    Icon: ShieldAlert,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/engagements" });
      close();
    },
  },
  {
    id: "go-lab",
    label: "Go to Lab",
    hint: "g l",
    Icon: Beaker,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/lab" });
      close();
    },
  },
  {
    id: "go-audit",
    label: "Go to Audit Log",
    Icon: FileText,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/audit" });
      close();
    },
  },
  {
    id: "go-settings",
    label: "Go to Settings",
    Icon: Settings,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/settings/account" });
      close();
    },
  },
  {
    id: "go-design-system",
    label: "Open Design System",
    Icon: Radar,
    group: "Navigate",
    perform: ({ navigate, close }) => {
      void navigate({ to: "/design-system" });
      close();
    },
  },

  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    hint: "[ / ]",
    Icon: PanelLeftClose,
    group: "Verbs",
    perform: ({ ui, close }) => {
      ui.toggleSidebar();
      close();
    },
  },
  {
    id: "open-cheat-sheet",
    label: "Show keyboard shortcuts",
    hint: "?",
    Icon: Keyboard,
    group: "Verbs",
    perform: ({ ui, close }) => {
      ui.openCheatSheet();
      close();
    },
  },

  {
    id: "toggle-lab-preview",
    label: "Toggle Lab Mode chrome preview",
    Icon: Beaker,
    group: "Lab",
    perform: ({ lab, close }) => {
      lab.togglePreview();
      close();
    },
  },
];

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * Pure navigation + UI verbs in Stage 2; recent items, sensor jumps,
 * and mutating verbs (with inline confirm per design spec §7) land in
 * later stages.
 */
export function CommandPalette(): JSX.Element {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return <></>;

  const ctx: PaletteContext = {
    navigate,
    ui: useUIStore.getState(),
    lab: useLabModeStore.getState(),
    close,
  };

  const groups = Array.from(new Set(ITEMS.map((i) => i.group)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg-0/60 backdrop-blur-md px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <Command
        className={cn(
          "w-full max-w-xl overflow-hidden rounded-lg border border-fg-20 bg-bg-2",
          "shadow-2xl shadow-black/40",
        )}
        label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-fg-20 px-4 py-3">
          <CommandIcon className="size-4 text-fg-60" aria-hidden="true" />
          <Command.Input
            placeholder="Jump to a route, run a verb…"
            className="flex-1 bg-transparent text-sm text-fg-100 placeholder:text-fg-40 focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-96 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-xs text-fg-60">
            No matches.
          </Command.Empty>
          {groups.map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-60"
            >
              {ITEMS.filter((i) => i.group === group).map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.group} ${item.label}`}
                  onSelect={() => item.perform(ctx)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-fg-80 aria-selected:bg-bg-3 aria-selected:text-fg-100"
                >
                  <item.Icon className="size-4 text-fg-60" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <Kbd>{item.hint}</Kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
