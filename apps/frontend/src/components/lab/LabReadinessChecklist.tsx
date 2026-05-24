import { Link } from "@tanstack/react-router";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { components } from "@/services/api/openapi";

type LabStatus = components["schemas"]["LabStatusResponse"];
type ReadinessCheck = components["schemas"]["ReadinessCheck"];

interface LabReadinessChecklistProps {
  status: LabStatus;
}

/**
 * Renders the operator-facing gate checklist returned by
 * `GET /api/v1/lab/status` (PR #60). Each check is a row:
 * `ok` / `missing` / `not_applicable` with the server-provided
 * `label`, `fix_hint`, and optional `fix_route`. When the backend
 * exposes a `fix_route`, the hint becomes a router `<Link>` so the
 * operator can jump straight to the surface that resolves the gate
 * (Account → Re-verify, Engagements → New, etc).
 *
 * Falls back to the pre-#60 inline gate list when the response
 * doesn't carry `checks` (older backends), so the view stays
 * useful across deploy boundaries.
 */
export function LabReadinessChecklist({ status }: LabReadinessChecklistProps): JSX.Element {
  const checks = status.checks ?? legacyFallbackChecks(status);
  const allGreen = status.ready || checks.every((c) => c.status !== "missing");

  return (
    <section
      data-testid="lab-readiness-checklist"
      aria-label="Lab readiness checklist"
      className={cn(
        "rounded-md border p-3 text-sm",
        allGreen
          ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
          : "border-accent-amber/40 bg-accent-amber/10 text-accent-amber",
      )}
    >
      <header className="flex items-center gap-2 text-2xs uppercase tracking-wide">
        {allGreen ? (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        ) : (
          <XCircle className="size-3.5" aria-hidden="true" />
        )}
        Lab readiness
      </header>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs sm:grid sm:grid-cols-2 sm:gap-2">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </section>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }): JSX.Element {
  const Icon =
    check.status === "ok"
      ? CheckCircle2
      : check.status === "not_applicable"
        ? MinusCircle
        : XCircle;
  const iconClass =
    check.status === "ok"
      ? "text-accent-green"
      : check.status === "not_applicable"
        ? "text-fg-40"
        : "text-accent-red";
  return (
    <li
      data-testid="lab-readiness-check"
      data-check-id={check.id}
      data-check-status={check.status}
      className="flex items-start gap-2 text-fg-100"
    >
      <Icon className={cn("size-3 shrink-0", iconClass)} aria-hidden="true" />
      <span className="flex flex-col">
        <span>{check.label}</span>
        {check.status === "missing" && (
          <FixHint hint={check.fix_hint} route={check.fix_route ?? null} />
        )}
      </span>
    </li>
  );
}

function FixHint({ hint, route }: { hint: string; route: string | null }): JSX.Element {
  if (!route) {
    return <span className="text-2xs text-fg-60">{hint}</span>;
  }
  return (
    <Link
      to={route}
      className="text-2xs text-fg-60 underline-offset-2 hover:text-fg-100 hover:underline"
      data-testid="lab-readiness-fix-link"
    >
      {hint}
    </Link>
  );
}

/**
 * Last-resort fallback when the backend predates PR #60 and the
 * `checks` array is missing. Mirrors the three legacy flags the old
 * `GateStatusBanner` rendered. Kept here so the new component is
 * the single rendering surface — LabView no longer has to choose.
 */
function legacyFallbackChecks(status: LabStatus): ReadinessCheck[] {
  return [
    {
      id: "lab_mode_env",
      label: "LAB_MODE=true in backend env",
      status: status.lab_mode ? "ok" : "missing",
      fix_hint: "Set LAB_MODE=true on the backend.",
    },
    {
      id: "authorized_operator",
      label: "Authorized-operator acknowledgement on file",
      status: status.acknowledgement_on_file ? "ok" : "missing",
      fix_hint: "Accept the authorized-operator statement in Settings → System.",
      fix_route: "/settings/system",
    },
    {
      id: "admin_role",
      label: "Admin role + recent 2FA",
      status: status.is_admin_2fa ? "ok" : "missing",
      fix_hint: "Sign in as admin and re-verify TOTP under Settings → Account.",
      fix_route: "/settings/account",
    },
  ];
}
