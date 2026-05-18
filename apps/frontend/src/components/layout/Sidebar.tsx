import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Beaker,
  Bell,
  FileText,
  type LucideIcon,
  Map as MapIcon,
  Radar,
  Router as RouterIcon,
  Settings,
  ShieldAlert,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Glyph } from "@/components/branding/Glyph";
import { Wordmark } from "@/components/branding/Wordmark";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { useLastMessageAt } from "@/services/ws/hooks";
import { useUIStore } from "@/stores/useUIStore";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  hint?: string;
  /** Only show when lab-mode preview is on. */
  labOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Recon",
    items: [
      { to: "/", label: "Overview", Icon: Activity, hint: "g o" },
      { to: "/sensors", label: "Sensors", Icon: RouterIcon, hint: "g s" },
      { to: "/networks", label: "Networks", Icon: Wifi, hint: "g n" },
      { to: "/devices", label: "Devices", Icon: Smartphone, hint: "g d" },
      { to: "/events", label: "Events", Icon: FileText, hint: "g e" },
      { to: "/map", label: "Map", Icon: MapIcon },
      { to: "/alerts", label: "Alerts", Icon: Bell, hint: "g a" },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/engagements", label: "Engagements", Icon: ShieldAlert },
      { to: "/lab", label: "Lab", Icon: Beaker, hint: "g l", labOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/audit", label: "Audit", Icon: FileText },
      { to: "/settings/account", label: "Settings", Icon: Settings },
      { to: "/design-system", label: "Design System", Icon: Radar },
    ],
  },
];

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }): JSX.Element {
  const { location } = useRouterState();
  const active =
    item.to === "/"
      ? location.pathname === "/"
      : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

  const content = (
    <Link
      to={item.to}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors duration-fast",
        active ? "bg-bg-1 text-fg-100" : "text-fg-80 hover:bg-bg-1 hover:text-fg-100",
        collapsed && "justify-center px-0",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-mode"
        />
      )}
      <item.Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.hint && <Kbd>{item.hint}</Kbd>}
    </Link>
  );

  if (!collapsed) return content;
  return (
    <Tooltip content={item.label} side="right">
      {content}
    </Tooltip>
  );
}

export function Sidebar(): JSX.Element {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const labPreview = useLabModeStore((s) => s.preview);
  // The wordmark's `//` pulses when an operator-WS message arrived within
  // the last 5s. `useLastMessageAt` returns the timestamp; `useLivePulse`
  // inside `Wordmark` does the windowing + 1Hz tick down to stale.
  const lastEventAt = useLastMessageAt();

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-fg-20 bg-bg-2 transition-[width] duration-base ease-[var(--ease-out-expo)]",
        collapsed ? "w-14" : "w-52",
      )}
      aria-label="Primary"
    >
      <Link
        to="/"
        className={cn(
          "flex h-12 items-center gap-2.5 border-b border-fg-20 px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <Glyph className="size-6 text-mode" label={collapsed ? "Cheeky Pony" : ""} />
        {!collapsed && <Wordmark className="text-sm" lastEventAt={lastEventAt} />}
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.labOnly || labPreview);
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="mb-4 last:mb-0">
              {!collapsed && (
                <div className="px-2 pb-1.5 text-2xs uppercase tracking-wide text-fg-60">
                  {group.label}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <NavLink key={item.to} item={item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-fg-20 px-3 py-2 font-mono text-2xs text-fg-40">
          <span>cheeky-pony · stage 2 · v0.2.0</span>
        </div>
      )}
    </aside>
  );
}
