import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { useEventsList, type Event as ApiEvent } from "@/services/api/queries";

/**
 * Human label for an EventKind. Lowercased + space-separated to match
 * the live-event stream styling on the Overview.
 */
function eventKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

const ALL_KINDS = ["access_point_seen", "client_seen", "sensor_status", "command_result"] as const;

function summary(ev: ApiEvent): string {
  const payload = ev.payload as Record<string, unknown>;
  if (ev.kind === "access_point_seen") {
    const ssid = payload.ssid as string | undefined;
    const bssid = payload.bssid as string | undefined;
    return ssid ? `${ssid} (${bssid ?? "?"})` : (bssid ?? "<hidden>");
  }
  if (ev.kind === "client_seen") {
    return (payload.mac as string | undefined) ?? "<unknown>";
  }
  if (ev.kind === "sensor_status") {
    return (payload.status as string | undefined) ?? "status";
  }
  if (ev.kind === "command_result") {
    return (payload.command as string | undefined) ?? "command";
  }
  return ev.id;
}

const columns: ColumnDef<ApiEvent, unknown>[] = [
  {
    accessorKey: "kind",
    header: "Kind",
    cell: (ctx) => (
      <Badge tone="neutral" outline>
        {eventKindLabel(ctx.getValue<string>())}
      </Badge>
    ),
    size: 180,
  },
  {
    accessorKey: "sensor_id",
    header: "Sensor",
    cell: (ctx) => <span className="font-mono text-xs text-fg-80">{ctx.getValue<string>()}</span>,
    size: 200,
  },
  {
    id: "summary",
    header: "Summary",
    cell: (ctx) => (
      <span className="truncate font-mono text-xs text-fg-100">{summary(ctx.row.original)}</span>
    ),
  },
  {
    accessorKey: "occurred_at",
    header: "When",
    cell: (ctx) => {
      const value = ctx.getValue<string | undefined>();
      return value ? <RelativeTime value={value} /> : <span className="text-fg-40">—</span>;
    },
    size: 110,
  },
];

/**
 * Events log view. Reads the paginated `/api/v1/events` page, filters
 * by kind (multi-select chips), text-searches across all columns, and
 * shows a JSON-payload detail drawer keyed by `?id=` so each event is
 * deep-linkable.
 *
 * Stage 8 (reporting) will add JSONL export. Live appends from the
 * operator WebSocket already live on the Overview stream; this page
 * is the historical / searchable surface.
 */
export function EventsView(): JSX.Element {
  const navigate = useNavigate();
  const search: { id?: string; q?: string; kinds?: string } = useSearch({ strict: false });
  const query = useEventsList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const selectedKinds = useMemo<string[]>(
    () => (search.kinds ? search.kinds.split(",").filter(Boolean) : []),
    [search.kinds],
  );

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const filtered = useMemo(
    () =>
      selectedKinds.length === 0 ? items : items.filter((e) => selectedKinds.includes(e.kind)),
    [items, selectedKinds],
  );
  const selected = useMemo(
    () => (search.id ? items.find((e) => e.id === search.id) : undefined),
    [search.id, items],
  );

  const openDetail = (event: ApiEvent): void => {
    void navigate({ to: "/events", search: { q: search.q, kinds: search.kinds, id: event.id } });
  };
  const closeDetail = (): void => {
    void navigate({ to: "/events", search: { q: search.q, kinds: search.kinds } });
  };
  const toggleKind = (kind: string): void => {
    const next = selectedKinds.includes(kind)
      ? selectedKinds.filter((k) => k !== kind)
      : [...selectedKinds, kind];
    void navigate({
      to: "/events",
      search: { q: search.q, id: search.id, kinds: next.length === 0 ? undefined : next.join(",") },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        total={query.data?.total}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Filter by kind, sensor, summary…",
        }}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="event-kind-filters">
        <span className="text-2xs uppercase tracking-wide text-fg-60">Kinds:</span>
        {ALL_KINDS.map((kind) => {
          const active = selectedKinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-sm border border-mode/40 bg-mode/15 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-mode"
                  : "rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-fg-60 hover:text-fg-100"
              }
            >
              {eventKindLabel(kind)}
            </button>
          );
        })}
        {selectedKinds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: "/events", search: { q: search.q, id: search.id } })}
          >
            Clear
          </Button>
        )}
      </div>

      <DataTable<ApiEvent>
        data={filtered}
        columns={columns}
        globalFilter={searchTerm}
        onRowOpen={openDetail}
        getRowId={(row) => row.id}
        label="Events"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No events recorded yet"
            description="Connect a sensor and start a capture; observed events surface here in real time."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={closeDetail}
        title={
          <div className="flex items-center gap-3 truncate">
            <Badge tone="neutral" outline>
              {eventKindLabel(selected?.kind ?? "")}
            </Badge>
            <span className="truncate font-mono text-xs text-fg-80">{selected?.id}</span>
          </div>
        }
      >
        {selected ? (
          <EventDetail event={selected} />
        ) : (
          <EmptyState title="Event not in current page" />
        )}
      </Drawer>
    </div>
  );
}

function EventDetail({ event }: { event: ApiEvent }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="ID"
          value={<span className="font-mono text-xs text-fg-80">{event.id}</span>}
        />
        <DetailRow
          label="Kind"
          value={
            <Badge tone="neutral" outline>
              {eventKindLabel(event.kind)}
            </Badge>
          }
        />
        <DetailRow
          label="Sensor"
          value={<span className="font-mono text-xs text-fg-80">{event.sensor_id}</span>}
        />
        <DetailRow
          label="Occurred"
          value={
            event.occurred_at ? (
              <RelativeTime value={event.occurred_at} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
      </DetailSection>

      <DetailSection label="Payload">
        <pre
          data-testid="event-payload"
          className="overflow-x-auto rounded-sm border border-fg-20 bg-bg-inset p-3 font-mono text-2xs text-fg-80"
        >
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </DetailSection>
    </div>
  );
}
