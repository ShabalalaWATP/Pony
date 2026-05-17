import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { LiveDot } from "@/components/domain/LiveDot";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { type Alert, useAckAlert, useAlertsList } from "@/services/api/queries";
import { useLiveTopic, useOperatorConnection } from "@/services/ws/hooks";
import { cn } from "@/lib/cn";

const RECENT_CAP = 10;

interface AlertEntry {
  alert: Alert;
  /** Wall-clock ms when the entry entered the panel (0 for HTTP-seeded rows). */
  addedAt: number;
}

function mergeAlerts(entries: AlertEntry[], incoming: Alert[]): AlertEntry[] {
  if (incoming.length === 0) return entries;
  const seen = new Set(entries.map((e) => e.alert.id));
  const fresh: AlertEntry[] = [];
  const now = Date.now();
  for (const a of incoming) {
    if (seen.has(a.id)) continue;
    fresh.push({ alert: a, addedAt: now });
    seen.add(a.id);
  }
  if (fresh.length === 0) return entries;
  return [...fresh, ...entries].slice(0, RECENT_CAP);
}

/**
 * Recent-alerts panel on the operator overview.
 *
 * Seeds from `GET /api/v1/alerts?limit=10` on mount, then prepends
 * fresh alerts received over the operator WebSocket on the
 * `alerts.fire` topic. Each new row gets the 1.5s cyan halo per design
 * spec §9. The ack button hits `POST /api/v1/alerts/{id}/ack` and lets
 * the query invalidation refresh the panel.
 */
export function OverviewRecentAlerts(): JSX.Element {
  const { state } = useOperatorConnection();
  const query = useAlertsList({ limit: RECENT_CAP });
  const ack = useAckAlert();
  const [entries, setEntries] = useState<AlertEntry[]>([]);
  const seedHandled = useRef(false);

  useEffect(() => {
    if (seedHandled.current) return;
    const items = query.data?.items;
    if (!items) return;
    setEntries(items.map((alert) => ({ alert, addedAt: 0 })));
    seedHandled.current = true;
  }, [query.data?.items]);

  useLiveTopic("alerts.fire", (msg) => {
    const payload = (msg.alert ?? msg.data) as Alert | undefined;
    if (!payload || typeof payload.id !== "string") return;
    setEntries((prev) => mergeAlerts(prev, [payload]));
  });

  const liveState = useMemo<"live" | "stale" | "offline">(() => {
    if (state === "open") return "live";
    if (state === "connecting") return "stale";
    return "offline";
  }, [state]);

  return (
    <div className="overflow-hidden rounded-md border border-fg-20 bg-bg-2">
      <Header live={liveState} />
      {query.isLoading ? (
        <div className="flex flex-col gap-1.5 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No alerts yet"
          description="Define a rule on /alerts/rules; matches stream in here in real time."
        />
      ) : (
        <ul className="divide-y divide-fg-20" data-testid="overview-recent-alerts">
          {entries.map(({ alert, addedAt }) => {
            const fresh = Date.now() - addedAt < 1500 && addedAt > 0;
            return (
              <li
                key={alert.id}
                className={cn(
                  "relative flex items-center gap-3 px-4 py-2 text-xs",
                  fresh && "cp-fresh",
                )}
              >
                <AlertSeverityChip severity={alert.severity} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    to="/alerts"
                    className="truncate text-fg-100 hover:underline"
                    aria-label={`Open alert ${alert.id}`}
                  >
                    {alert.related_entities?.[0] ?? alert.rule_id}
                  </Link>
                  {alert.acked_at && (
                    <span className="text-2xs text-fg-60">
                      acked by {alert.acked_by ?? "unknown"}
                    </span>
                  )}
                </div>
                {alert.acked_at ? (
                  <Badge tone="green" outline>
                    acked
                  </Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => ack.mutate(alert.id)}
                    disabled={ack.isPending && ack.variables === alert.id}
                    className="rounded-xs border border-fg-20 px-2 py-0.5 text-2xs uppercase tracking-wide text-fg-80 hover:border-fg-40 disabled:opacity-50"
                  >
                    Ack
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Header({ live }: { live: "live" | "stale" | "offline" }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-fg-20 px-4 py-2.5">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
        <Bell className="size-3" aria-hidden="true" />
        Recent alerts
      </div>
      <LiveDot state={live} />
    </div>
  );
}
