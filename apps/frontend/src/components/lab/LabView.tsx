import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertOctagon,
  Beaker,
  CheckCircle2,
  Globe,
  Network,
  ShieldX,
  Skull,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { ActiveLabCommandsList } from "./ActiveLabCommandsList";
import { EngagementPanel } from "./EngagementPanel";
import { ReportsPanel } from "./ReportsPanel";
import { StartLabModuleDialog } from "./StartLabModuleDialog";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import {
  type LabModule,
  type LabStatusResponse,
  useActiveEngagement,
  useLabStatus,
} from "@/services/api/labQueries";

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
 * The gate banner reads from `GET /lab/status` so the operator sees
 * each missing gate up-front instead of inferring it from a refused
 * fire. The URL carries `?module=` so a launched dialog is shareable
 * (useful for a runbook screenshot or a Linear ticket).
 */
export function LabView(): JSX.Element {
  const navigate = useNavigate();
  const search: LabSearch = useSearch({ strict: false });
  const engagementQuery = useActiveEngagement();
  const labStatusQuery = useLabStatus();
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
    engagementQuery.error?.status === 401 ||
    engagementQuery.error?.status === 403 ||
    labStatusQuery.error?.status === 401 ||
    labStatusQuery.error?.status === 403;
  const status = labStatusQuery.data ?? null;
  const allGatesGreen = Boolean(
    status?.lab_mode && status.acknowledgement_on_file && status.is_admin_2fa && engagement,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Lab" />

      {unauthorized && (
        <EmptyState
          title="Sign in required"
          description="The lab surface needs an authenticated admin session with recent 2FA."
        />
      )}

      {!unauthorized && status && (
        <GateStatusBanner status={status} hasEngagement={Boolean(engagement)} />
      )}

      {!unauthorized && noEngagement && !status && (
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
            disabled={!allGatesGreen}
            onConfigure={() => openModule(m.id)}
          />
        ))}
      </section>

      <ActiveLabCommandsList />

      {engagement && <ReportsPanel engagement={engagement} />}

      <StartLabModuleDialog module={activeModule} engagement={engagement} onClose={closeModule} />
    </div>
  );
}

interface GateStatusBannerProps {
  status: LabStatusResponse;
  hasEngagement: boolean;
}

/**
 * Surfaces each lab-gate flag so the operator can see exactly which
 * gate is still failing before they pick a target. The `engagement`
 * flag derives from the separate `/engagements/active` call — keeping
 * them on the same banner keeps the diagnostic in one place.
 */
function GateStatusBanner({ status, hasEngagement }: GateStatusBannerProps): JSX.Element {
  const gates: { label: string; ok: boolean; hint: string }[] = [
    {
      label: "Lab mode",
      ok: status.lab_mode,
      hint: "Set LAB_MODE=true on the backend.",
    },
    {
      label: "Authorized-operator acknowledgement",
      ok: status.acknowledgement_on_file,
      hint: "Accept the authorized-operator statement under /settings.",
    },
    {
      label: "Admin + recent 2FA",
      ok: status.is_admin_2fa,
      hint: "Sign in as admin and re-verify TOTP.",
    },
    {
      label: "Active engagement",
      ok: hasEngagement,
      hint: "Create or resume an engagement at /engagements.",
    },
  ];
  const allGreen = gates.every((g) => g.ok);

  return (
    <section
      data-testid="lab-gate-banner"
      className={
        allGreen
          ? "rounded-md border border-accent-green/40 bg-accent-green/10 p-3 text-sm text-accent-green"
          : "rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm text-accent-amber"
      }
    >
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wide">
        {allGreen ? (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        ) : (
          <ShieldX className="size-3.5" aria-hidden="true" />
        )}
        Lab gates
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
        {gates.map((g) => (
          <li
            key={g.label}
            data-testid="lab-gate"
            data-ok={g.ok}
            className="flex items-start gap-2 text-fg-100"
          >
            {g.ok ? (
              <CheckCircle2 className="size-3 shrink-0 text-accent-green" aria-hidden="true" />
            ) : (
              <XCircle className="size-3 shrink-0 text-accent-red" aria-hidden="true" />
            )}
            <span className="flex flex-col">
              <span>{g.label}</span>
              {!g.ok && <span className="text-2xs text-fg-60">{g.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
