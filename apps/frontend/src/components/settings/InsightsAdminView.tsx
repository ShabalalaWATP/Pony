import { AlertTriangle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { useLlmUsage, useToggleKillSwitch } from "@/services/api/insightQueries";

/**
 * Admin-only LLM operations panel. Shows monthly spend against the
 * configured budget, per-kind generation counts for the last 30
 * days, and the runtime kill-switch toggle. The toggle is typed-
 * confirm (`DISABLE` / `ENABLE` in the request body) to mirror the
 * sensor-revoke + PCAP-delete patterns and to enforce the
 * backend's KillSwitchRequest contract.
 */
export function InsightsAdminView(): JSX.Element {
  const usage = useLlmUsage();
  const toggle = useToggleKillSwitch();

  if (usage.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="AI insights" />
        <EmptyState title="Admin only" description="LLM usage telemetry is restricted to admins." />
      </div>
    );
  }

  const data = usage.data;
  // The kill-switch state isn't fetched directly here — the usage
  // response will round-trip after a successful toggle thanks to the
  // mutation's cache invalidation, so the user-visible effect is
  // immediate.

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI insights" />

      {usage.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : data ? (
        <>
          <BudgetCard data={data} />
          <PerKindUsage rows={data.last_30_days} />
          <KillSwitch
            onToggle={(enable, confirm) => toggle.mutate({ enable, confirm })}
            pending={toggle.isPending}
            error={toggle.error?.message}
          />
        </>
      ) : null}
    </div>
  );
}

type Usage = NonNullable<ReturnType<typeof useLlmUsage>["data"]>;

function BudgetCard({ data }: { data: Usage }): JSX.Element {
  const overBudget =
    data.budget_micro_cents !== null &&
    data.budget_remaining_micro_cents !== null &&
    data.budget_remaining_micro_cents <= 0;
  return (
    <section
      data-testid="llm-budget-card"
      className="flex flex-wrap items-center gap-4 rounded-md border border-fg-20 bg-bg-2 p-4 text-sm"
    >
      <Sparkles className="size-5 text-accent-violet" aria-hidden="true" />
      <div className="flex-1">
        <div className="text-2xs uppercase tracking-wide text-fg-60">
          Spend ({data.current_month})
        </div>
        <div className="font-mono text-lg text-fg-100" data-testid="llm-current-spend">
          ${data.current_month_spend_usd}
        </div>
      </div>
      <div>
        <div className="text-2xs uppercase tracking-wide text-fg-60">Budget</div>
        <div className="font-mono text-sm text-fg-100">
          {data.budget_micro_cents === null ? "unlimited" : `$${data.budget_remaining_usd} left`}
        </div>
      </div>
      {overBudget && (
        <Badge tone="red" outline>
          <AlertTriangle className="size-3" aria-hidden="true" />
          Budget exceeded
        </Badge>
      )}
    </section>
  );
}

function PerKindUsage({ rows }: { rows: Usage["last_30_days"] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-fg-20 bg-bg-2 p-4 text-sm">
        <div className="text-2xs uppercase tracking-wide text-fg-60">Last 30 days</div>
        <p className="mt-2 text-xs text-fg-60">No insights generated yet.</p>
      </section>
    );
  }
  return (
    <section
      data-testid="llm-per-kind-table"
      className="overflow-x-auto rounded-md border border-fg-20 bg-bg-2"
    >
      <div className="border-b border-fg-20 p-3 text-2xs uppercase tracking-wide text-fg-60">
        Last 30 days
      </div>
      <table className="w-full text-left text-xs text-fg-80">
        <thead>
          <tr>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Generated</th>
            <th className="px-3 py-2 font-medium">Cached</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className="border-t border-fg-20" data-testid={`llm-row-${r.kind}`}>
              <td className="px-3 py-2 font-mono text-2xs">{r.kind.replace(/_/g, " ")}</td>
              <td className="px-3 py-2 tabular-nums">{r.generated}</td>
              <td className="px-3 py-2 tabular-nums">{r.cached}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface KillSwitchProps {
  onToggle: (enable: boolean, confirm: "ENABLE" | "DISABLE") => void;
  pending: boolean;
  error?: string;
}

function KillSwitch({ onToggle, pending, error }: KillSwitchProps): JSX.Element {
  const [typed, setTyped] = useState("");
  const [intent, setIntent] = useState<"DISABLE" | "ENABLE">("DISABLE");

  const matches = typed === intent;
  const submit = (): void => {
    if (!matches) return;
    onToggle(intent === "ENABLE", intent);
    setTyped("");
  };

  return (
    <section
      data-testid="llm-kill-switch"
      className="rounded-md border border-accent-amber/40 bg-accent-amber/5 p-4 text-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-4 text-accent-amber" aria-hidden="true" />
        <span className="font-medium text-fg-100">Runtime kill switch</span>
      </div>
      <p className="text-xs text-fg-80">
        Overrides the <code className="rounded-xs bg-bg-3 px-1">LLM_ENABLED</code> env var. Use to
        immediately halt LLM calls if sensitive data was captured during a session.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value as "DISABLE" | "ENABLE")}
          className="rounded-sm border border-fg-20 bg-bg-1 px-2 py-1 text-xs"
          data-testid="kill-switch-intent"
        >
          <option value="DISABLE">Disable</option>
          <option value="ENABLE">Re-enable</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-fg-80">
          Type <code className="rounded-xs bg-bg-3 px-1 font-mono text-accent-amber">{intent}</code>{" "}
          to confirm
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-testid="kill-switch-confirm-input"
            className="rounded-sm border border-fg-20 bg-bg-1 px-2 py-1 font-mono text-fg-100"
            autoComplete="off"
          />
        </label>
        <Button
          variant={intent === "DISABLE" ? "danger" : "primary"}
          size="sm"
          onClick={submit}
          disabled={!matches || pending}
          data-testid="kill-switch-submit"
        >
          {pending ? "Applying…" : intent === "DISABLE" ? "Disable AI" : "Re-enable AI"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-accent-red">
          {error}
        </p>
      )}
    </section>
  );
}
