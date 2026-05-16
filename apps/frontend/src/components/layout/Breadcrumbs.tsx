import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/cn";

const TITLES: Record<string, string> = {
  "": "Overview",
  sensors: "Sensors",
  networks: "Networks",
  devices: "Devices",
  events: "Events",
  alerts: "Alerts",
  map: "Map",
  engagements: "Engagements",
  lab: "Lab",
  audit: "Audit",
  settings: "Settings",
  account: "Account",
  users: "Users",
  system: "System",
  about: "About",
  rules: "Rules",
  "design-system": "Design System",
  "rogue-ap": "Rogue AP",
  deauth: "Deauth",
  "evil-twin": "Evil Twin",
  "captive-portal": "Captive Portal",
  mitm: "MITM",
  login: "Login",
};

function title(segment: string): string {
  return TITLES[segment] ?? segment;
}

interface Crumb {
  label: string;
  to: string;
  /** True when the segment is an identifier (BSSID/MAC/UUID), not a known route name. */
  mono?: boolean;
}

function buildCrumbs(pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Overview", to: "/" }];
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    const known = seg in TITLES;
    crumbs.push({ label: known ? title(seg) : seg, to: acc, mono: !known });
  }
  return crumbs;
}

export function Breadcrumbs(): JSX.Element {
  const { location } = useRouterState();
  const crumbs = buildCrumbs(location.pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-fg-60">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.to} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-fg-40">/</span>}
            {isLast ? (
              <span className={cn("text-fg-100", crumb.mono && "font-mono")}>{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="hover:text-fg-100">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
