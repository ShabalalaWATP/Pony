import type { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Beaker,
  Bell,
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
import type { useLabModeStore } from "@/stores/useLabModeStore";
import type { useUIStore } from "@/stores/useUIStore";

export type PaletteGroup = "Navigate" | "Verbs" | "Lab";

export interface PaletteContext {
  navigate: ReturnType<typeof useNavigate>;
  ui: ReturnType<typeof useUIStore.getState>;
  lab: ReturnType<typeof useLabModeStore.getState>;
  close: () => void;
}

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  Icon: LucideIcon;
  group: PaletteGroup;
  perform: (ctx: PaletteContext) => void;
}

/** Build a "navigate to <path> then close" perform handler. */
function go(to: string): PaletteItem["perform"] {
  return ({ navigate, close }) => {
    void navigate({ to });
    close();
  };
}

/**
 * Static registry of command-palette items. Keeping the list out of the
 * `CommandPalette` component keeps the open/closed principle honoured —
 * future stages add commands here without touching the renderer.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  {
    id: "go-overview",
    label: "Go to Overview",
    hint: "g o",
    Icon: Activity,
    group: "Navigate",
    perform: go("/"),
  },
  {
    id: "go-sensors",
    label: "Go to Sensors",
    hint: "g s",
    Icon: RouterIcon,
    group: "Navigate",
    perform: go("/sensors"),
  },
  {
    id: "go-networks",
    label: "Go to Networks",
    hint: "g n",
    Icon: Wifi,
    group: "Navigate",
    perform: go("/networks"),
  },
  {
    id: "go-devices",
    label: "Go to Devices",
    hint: "g d",
    Icon: Smartphone,
    group: "Navigate",
    perform: go("/devices"),
  },
  {
    id: "go-events",
    label: "Go to Events",
    hint: "g e",
    Icon: FileText,
    group: "Navigate",
    perform: go("/events"),
  },
  {
    id: "go-alerts",
    label: "Go to Alerts",
    hint: "g a",
    Icon: Bell,
    group: "Navigate",
    perform: go("/alerts"),
  },
  { id: "go-map", label: "Go to Map", Icon: MapIcon, group: "Navigate", perform: go("/map") },
  {
    id: "go-engagements",
    label: "Go to Engagements",
    Icon: ShieldAlert,
    group: "Navigate",
    perform: go("/engagements"),
  },
  {
    id: "go-lab",
    label: "Go to Lab",
    hint: "g l",
    Icon: Beaker,
    group: "Navigate",
    perform: go("/lab"),
  },
  {
    id: "go-audit",
    label: "Go to Audit Log",
    Icon: FileText,
    group: "Navigate",
    perform: go("/audit"),
  },
  {
    id: "go-settings",
    label: "Go to Settings",
    Icon: Settings,
    group: "Navigate",
    perform: go("/settings/account"),
  },
  {
    id: "go-design-system",
    label: "Open Design System",
    Icon: Radar,
    group: "Navigate",
    perform: go("/design-system"),
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
