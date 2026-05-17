import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertOctagon,
  Beaker,
  Globe,
  Network,
  ShieldX,
  Skull,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { ActiveLabCommandsList } from "./ActiveLabCommandsList";
import { EngagementPanel } from "./EngagementPanel";
import { StartLabModuleDialog } from "./StartLabModuleDialog";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { type LabModule, useActiveEngagement } from "@/services/api/labQueries";

interface LabSearch {
  module?: string;
}

const MODULES: { id: LabModule; label: string; blurb: string; Icon: LucideIcon }[] = [
  {
    id: "rogue-ap",
    label: "Rogue AP",
    blurb: "Spawn a hostapd-mana SSID on a chosen sensor.",
    Icon: Wifi,
  },
  {
    id: "deauth",
    label: "Deauth",
    blurb: "Send targeted 802.11 deauthentication frames.",
    Icon: AlertOctagon,
  },
  {
    id: "evil-twin",
    label: "Evil Twin",
    blurb: "Mirror an SSID alongside a captive portal.",
    Icon: Skull,
  },
  {
    id: "captive-portal",
    label: "Captive Portal",
    blurb: "Stand up a captive web portal on the rogue interface.",
    Icon: Globe,
  },
  {
    id: "mitm",
    label: "MITM Proxy",
    blurb: "Route client traffic through bettercap's HTTPS proxy.",
    Icon: Network,
  },
];

const MODULE_IDS = new Set<LabModule>(MODULES.map((m) => m.id));

function parseModule(raw: string | undefined): LabModule | null {
  if (!raw) return null;
  return MODULE_IDS.has(raw as LabModule) ? (raw as LabModule) : null;
}

/**
 * Stage 7 lab hub.
 *
 * Composes the engagement banner, the five module cards, and the
 * active-command live stream into a single page. Every destructive
 * affordance is gated upstream by:
 *
 * - the backend's `ActiveGateService` (LAB_MODE, acknowledgement,
 *   admin + 2FA, engagement, allow-list — refusal surfaces as 403
 *   with `{ reason, detail }`)
 * - the operator's typed confirm field on the Start dialog
 *
 * The URL carries `?module=` so a launched dialog is shareable
 * (useful for a runbook screenshot or a Linear ticket).
 */
export function LabView(): JSX.Element {
  const navigate = useNavigate();
  const search: LabSearch = useSearch({ strict: false });
  const engagementQuery = useActiveEngagement();
  const activeModule = useMemo(() => parseModule(search.module), [search.module]);

  const openModule = (m: LabModule): void => {
    void navigate({ to: "/lab", search: { module: m } });
  };
  const closeModule = (): void => {
    void navigate({ to: "/lab", search: {} });
  };

  const engagement = engagementQuery.data ?? null;
  const noEngagement = engagementQuery.error?.status === 404;
  const unauthorized =
    engagementQuery.error?.status === 401 || engagementQuery.error?.status === 403;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Lab" />

      {unauthorized && (
        <EmptyState
          title="Sign in required"
          description="The lab surface needs an authenticated admin session with recent 2FA."
        />
      )}

      {!unauthorized && noEngagement && (
        <div className="flex flex-col gap-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-4 text-sm text-accent-amber">
          <div className="flex items-center gap-2">
            <ShieldX className="size-4" aria-hidden="true" />
            <strong>No active engagement</strong>
          </div>
          <p className="text-xs text-fg-80">
            Every lab action is scoped to an engagement and a target allow-list. Create or resume an
            engagement from /engagements before firing a module.
          </p>
        </div>
      )}

      {engagement && <EngagementPanel engagement={engagement} />}

      <section
        data-testid="lab-modules"
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      >
        {MODULES.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            disabled={!engagement}
            onConfigure={() => openModule(m.id)}
          />
        ))}
      </section>

      <ActiveLabCommandsList />

      <StartLabModuleDialog module={activeModule} engagement={engagement} onClose={closeModule} />
    </div>
  );
}

interface ModuleCardProps {
  module: { id: LabModule; label: string; blurb: string; Icon: LucideIcon };
  disabled: boolean;
  onConfigure: () => void;
}

function ModuleCard({ module, disabled, onConfigure }: ModuleCardProps): JSX.Element {
  const { Icon } = module;
  return (
    <article
      data-testid={`module-card-${module.id}`}
      className="flex flex-col gap-3 rounded-md border border-fg-20 bg-bg-2 p-4"
    >
      <div className="flex items-center gap-2 text-fg-100">
        <Beaker className="size-3.5 text-accent-violet" aria-hidden="true" />
        <Icon className="size-4" aria-hidden="true" />
        <span className="font-medium">{module.label}</span>
      </div>
      <p className="flex-1 text-xs text-fg-80">{module.blurb}</p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onConfigure}
        disabled={disabled}
        aria-label={`Configure ${module.label}`}
      >
        Configure
      </Button>
    </article>
  );
}
