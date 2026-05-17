import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { LiveDot } from "@/components/domain/LiveDot";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { useEventsList, type Event as ApiEvent } from "@/services/api/queries";
import { useLiveTopic, useOperatorConnection } from "@/services/ws/hooks";
import { cn } from "@/lib/cn";

const STREAM_CAP = 50;

function eventKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

function eventSummary(ev: ApiEvent): string {
  const payload = ev.payload as Record<string, unknown>;
  if (ev.kind === "access_point_seen") {
    const ssid = payload.ssid as string | undefined;
    const bssid = payload.bssid as string | undefined;
    return ssid ? `${ssid} (${bssid ?? "?"})` : (bssid ?? "<hidden>");
  }
  if (ev.kind === "client_seen") {
    const mac = payload.mac as string | undefined;
    return mac ?? "<unknown>";
  }
  if (ev.kind === "sensor_status") {
    const status = payload.status as string | undefined;
    return status ?? "status";
  }
  if (ev.kind === "command_result") {
    const command = payload.command as string | undefined;
    return command ?? "command";
  }
  return ev.id;
}

interface StreamEntry {
  event: ApiEvent;
  /** Wall-clock timestamp when the entry entered the stream. */
  addedAt: number;
}

function mergeEvents(entries: StreamEntry[], incoming: ApiEvent[]): StreamEntry[] {
  if (incoming.length === 0) return entries;
  const seen = new Set(entries.map((e) => e.event.id));
  const fresh: StreamEntry[] = [];
  const now = Date.now();
  for (const ev of incoming) {
    if (seen.has(ev.id)) continue;
    fresh.push({ event: ev, addedAt: now });
    seen.add(ev.id);
  }
  if (fresh.length === 0) return entries;
  return [...fresh, ...entries].slice(0, STREAM_CAP);
}

/**
 * Live operator event stream. Seeds from the `/api/v1/events` HTTP page
 * on first load, then prepends fresh events received via the
 * `events.append` (or `event`) topic on the operator WebSocket. Each
 * insert gets the 1.5s cyan halo per design spec §9. The list is
 * capped at `STREAM_CAP` rows; older events stay queryable from
 * `/events`.
 */
export function OverviewEventStream(): JSX.Element {
  const { state } = useOperatorConnection();
  const query = useEventsList({ limit: STREAM_CAP });
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const seedHandled = useRef(false);

  // Seed from the HTTP page once on first successful load.
  useEffect(() => {
    if (seedHandled.current) return;
    const items = query.data?.items;
    if (!items) return;
    setEntries(items.map((event) => ({ event, addedAt: 0 })));
    seedHandled.current = true;
  }, [query.data?.items]);

  // Live append: any kind that looks like an event-append.
  useLiveTopic(
    (msg) => msg.kind === "event" || msg.kind === "events.append",
    (msg) => {
      const payload = (msg.event ?? msg.data) as ApiEvent | undefined;
      if (!payload || typeof payload.id !== "string") return;
      setEntries((prev) => mergeEvents(prev, [payload]));
    },
  );

  const liveState = useMemo<"live" | "stale" | "offline">(() => {
    if (state === "open") return "live";
    if (state === "connecting") return "stale";
    return "offline";
  }, [state]);

  if (query.isLoading) {
    return (
      <Card>
        <Header live="stale" />
        <div className="flex flex-col gap-1.5 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <Header live={liveState} />
        <EmptyState
          title="No events yet"
          description="Connect a sensor or wait for the first capture. New events stream in here in real time."
        />
      </Card>
    );
  }

  return (
    <Card>
      <Header live={liveState} />
      <ul className="divide-y divide-fg-20" data-testid="overview-event-stream">
        {entries.map(({ event, addedAt }) => {
          const fresh = Date.now() - addedAt < 1500 && addedAt > 0;
          return (
            <li
              key={event.id}
              className={cn(
                "relative flex items-center gap-3 px-4 py-2 text-xs",
                fresh && "cp-fresh",
              )}
            >
              <Badge tone="neutral" outline>
                {eventKindLabel(event.kind)}
              </Badge>
              <span className="flex-1 truncate font-mono text-fg-100">{eventSummary(event)}</span>
              {event.occurred_at && <RelativeTime value={event.occurred_at} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="overflow-hidden rounded-md border border-fg-20 bg-bg-2">{children}</div>;
}

function Header({ live }: { live: "live" | "stale" | "offline" }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-fg-20 px-4 py-2.5">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
        <Activity className="size-3" aria-hidden="true" />
        Live events
      </div>
      <LiveDot state={live} />
    </div>
  );
}
