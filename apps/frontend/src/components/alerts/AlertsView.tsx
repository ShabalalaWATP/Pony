import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { EmptyState } from "@/components/domain/EmptyState";
import { LiveDot } from "@/components/domain/LiveDot";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { InsightCard } from "@/components/insights/InsightCard";
import { type Alert, type AlertSeverity, useAckAlert, useAlertsList } from "@/services/api/queries";
import { useLiveTopic, useOperatorConnection } from "@/services/ws/hooks";

const ALL_SEVERITIES: AlertSeverity[] = ["critical", "high", "medium", "low", "info"];
type AckFilter = "all" | "unacked" | "acked";

interface AlertsSearch {
  id?: string;
  severities?: string;
  acked?: AckFilter;
}

function parseSeverities(raw: string | undefined): AlertSeverity[] {
  if (!raw) return [];
  const set = new Set<AlertSeverity>();
  for (const part of raw.split(",")) {
    if (ALL_SEVERITIES.includes(part as AlertSeverity)) set.add(part as AlertSeverity);
  }
  return [...set];
}

function buildColumns(
  onAck: (id: string) => void,
  ackPendingId: string | undefined,
): ColumnDef<Alert, unknown>[] {
  return [
    {
      accessorKey: "severity",
      header: "Severity",
      cell: (ctx) => <AlertSeverityChip severity={ctx.getValue<AlertSeverity>()} />,
      size: 130,
    },
    {
      accessorKey: "rule_id",
      header: "Rule",
      cell: (ctx) => (
        <span className="truncate font-mono text-xs text-fg-80">{ctx.getValue<string>()}</span>
      ),
      size: 200,
    },
    {
      id: "related",
      header: "Related",
      cell: (ctx) => {
        const related = ctx.row.original.related_entities ?? [];
        if (related.length === 0) return <span className="text-fg-40">—</span>;
        return (
          <span className="truncate font-mono text-xs text-fg-100">
            {related.slice(0, 2).join(", ")}
            {related.length > 2 && (
              <span className="ml-1 text-2xs text-fg-60">+{related.length - 2}</span>
            )}
          </span>
        );
      },
    },
    {
      id: "ack_state",
      header: "State",
      cell: (ctx) => {
        const a = ctx.row.original;
        return a.acked_at ? (
          <Badge tone="green" outline>
            <CheckCircle2 className="size-3" aria-hidden="true" />
            acked
          </Badge>
        ) : (
          <Badge tone="amber" outline>
            pending
          </Badge>
        );
      },
      size: 110,
    },
    {
      id: "acked_at",
      header: "Acknowledged",
      cell: (ctx) => {
        const v = ctx.row.original.acked_at;
        return v ? <RelativeTime value={v} /> : <span className="text-fg-40">—</span>;
      },
      size: 130,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: (ctx) => {
        const a = ctx.row.original;
        if (a.acked_at) return null;
        const pending = ackPendingId === a.id;
        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={(ev) => {
              ev.stopPropagation();
              onAck(a.id);
            }}
            aria-label={`Acknowledge alert ${a.id}`}
          >
            {pending ? "Acking…" : "Ack"}
          </Button>
        );
      },
      size: 100,
    },
  ];
}

/**
 * Alerts inbox.
 *
 * Reads `/api/v1/alerts` with multi-select severity filter chips and
 * an acked/unacked toggle, both deep-linkable through the URL. The
 * operator-WS `alerts.fire` topic invalidates the cache (via
 * `useOperatorCacheInvalidations` in the app shell) so this list
 * refreshes without a manual reload. Per-row `Ack` button posts to
 * `/alerts/{id}/ack`.
 */
export function AlertsView(): JSX.Element {
  const navigate = useNavigate();
  const search: AlertsSearch = useSearch({ strict: false });
  const { state } = useOperatorConnection();
  const ack = useAckAlert();

  const severities = useMemo(() => parseSeverities(search.severities), [search.severities]);
  const ackFilter: AckFilter = search.acked ?? "all";
  const ackedParam = ackFilter === "all" ? undefined : ackFilter === "acked";

  const query = useAlertsList({
    limit: 500,
    severity: severities.length === 0 ? undefined : severities,
    acked: ackedParam,
  });

  // Local toast — the table refreshes on the WS push, but a sub-pixel
  // toast keeps the operator informed when a new critical lands while
  // they're looking at a filtered view.
  const [latestSeverity, setLatestSeverity] = useState<AlertSeverity | null>(null);
  useLiveTopic("alerts.fire", (msg) => {
    const alert = (msg.alert ?? msg.data) as Alert | undefined;
    if (alert?.severity) setLatestSeverity(alert.severity);
  });
  useEffect(() => {
    if (!latestSeverity) return;
    const t = window.setTimeout(() => setLatestSeverity(null), 4000);
    return () => window.clearTimeout(t);
  }, [latestSeverity]);

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = useMemo(
    () => (search.id ? items.find((a) => a.id === search.id) : undefined),
    [search.id, items],
  );

  const toggleSeverity = (s: AlertSeverity): void => {
    const next = severities.includes(s) ? severities.filter((x) => x !== s) : [...severities, s];
    void navigate({
      to: "/alerts",
      search: {
        id: search.id,
        acked: ackFilter === "all" ? undefined : ackFilter,
        severities: next.length === 0 ? undefined : next.join(","),
      },
    });
  };
  const setAckFilter = (next: AckFilter): void => {
    void navigate({
      to: "/alerts",
      search: {
        id: search.id,
        severities: severities.length === 0 ? undefined : severities.join(","),
        acked: next === "all" ? undefined : next,
      },
    });
  };
  const openDetail = (a: Alert): void => {
    void navigate({
      to: "/alerts",
      search: {
        severities: search.severities,
        acked: search.acked,
        id: a.id,
      },
    });
  };
  const closeDetail = (): void => {
    void navigate({
      to: "/alerts",
      search: { severities: search.severities, acked: search.acked },
    });
  };

  const columns = useMemo(
    () => buildColumns((id) => ack.mutate(id), ack.isPending ? ack.variables : undefined),
    [ack],
  );

  const liveState: "live" | "stale" | "offline" =
    state === "open" ? "live" : state === "connecting" ? "stale" : "offline";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Alerts" total={query.data?.total}>
        <div className="flex items-center gap-2">
          <LiveDot state={liveState} />
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/alerts/rules" })}>
            Manage rules
          </Button>
        </div>
      </PageHeader>

      <SeverityChips selected={severities} onToggle={toggleSeverity} />
      <AckToggle value={ackFilter} onChange={setAckFilter} />

      {latestSeverity && (
        <div
          role="status"
          data-testid="alerts-live-toast"
          className="rounded-sm border border-mode/40 bg-mode/10 px-3 py-1.5 text-xs text-mode"
        >
          New <strong>{latestSeverity}</strong> alert just fired.
        </div>
      )}

      <DataTable<Alert>
        data={items}
        columns={columns}
        onRowOpen={openDetail}
        getRowId={(row) => row.id}
        label="Alerts"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="Nothing to see here"
            description="No alerts match the current filters. Tweak severities or define a new rule."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={closeDetail}
        title={
          selected ? (
            <div className="flex items-center gap-3 truncate">
              <AlertSeverityChip severity={selected.severity} />
              <span className="truncate font-mono text-xs text-fg-80">{selected.id}</span>
            </div>
          ) : (
            <span>Alert</span>
          )
        }
      >
        {selected ? (
          <AlertDetail
            alert={selected}
            onAck={() => ack.mutate(selected.id)}
            acking={ack.isPending && ack.variables === selected.id}
          />
        ) : (
          <EmptyState title="Alert not in current page" />
        )}
      </Drawer>
    </div>
  );
}

interface SeverityChipsProps {
  selected: AlertSeverity[];
  onToggle: (s: AlertSeverity) => void;
}
function SeverityChips({ selected, onToggle }: SeverityChipsProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="alert-severity-filters">
      <span className="text-2xs uppercase tracking-wide text-fg-60">Severity:</span>
      {ALL_SEVERITIES.map((s) => {
        const active = selected.includes(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggle(s)}
            aria-pressed={active}
            className={
              active
                ? "rounded-sm border border-mode/40 bg-mode/15 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-mode"
                : "rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-fg-60 hover:text-fg-100"
            }
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

interface AckToggleProps {
  value: AckFilter;
  onChange: (next: AckFilter) => void;
}
function AckToggle({ value, onChange }: AckToggleProps): JSX.Element {
  const opts: { key: AckFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unacked", label: "Unacked" },
    { key: "acked", label: "Acked" },
  ];
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Acknowledgement filter">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={
            value === o.key
              ? "rounded-sm border border-mode/40 bg-mode/15 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-mode"
              : "rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-fg-60 hover:text-fg-100"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface AlertDetailProps {
  alert: Alert;
  onAck: () => void;
  acking: boolean;
}
function AlertDetail({ alert, onAck, acking }: AlertDetailProps): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="ID"
          value={<span className="font-mono text-xs text-fg-80">{alert.id}</span>}
        />
        <DetailRow
          label="Rule"
          value={<span className="font-mono text-xs text-fg-80">{alert.rule_id}</span>}
        />
        <DetailRow label="Severity" value={<AlertSeverityChip severity={alert.severity} />} />
      </DetailSection>

      <DetailSection label="Related entities">
        {(alert.related_entities ?? []).length === 0 ? (
          <span className="text-xs text-fg-60">none</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {(alert.related_entities ?? []).map((e) => (
              <li key={e} className="font-mono text-xs text-fg-100">
                {e}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection label="Acknowledgement">
        {alert.acked_at ? (
          <>
            <DetailRow label="When" value={<RelativeTime value={alert.acked_at} />} />
            <DetailRow
              label="By"
              value={
                <span className="font-mono text-xs text-fg-80">{alert.acked_by ?? "unknown"}</span>
              }
            />
          </>
        ) : (
          <Button onClick={onAck} disabled={acking}>
            {acking ? "Acking…" : "Acknowledge"}
          </Button>
        )}
      </DetailSection>

      <InsightCard kind="alert_context" entityId={alert.id} />
    </div>
  );
}
