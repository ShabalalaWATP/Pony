import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { LiveDot } from "@/components/domain/LiveDot";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { useSensorsList, type Sensor } from "@/services/api/queries";

function sensorStatus(s: Sensor): "live" | "stale" | "offline" {
  if (s.revoked) return "offline";
  if (!s.last_seen) return "offline";
  const age = Date.now() - new Date(s.last_seen).getTime();
  if (age < 30_000) return "live";
  if (age < 5 * 60_000) return "stale";
  return "offline";
}

const columns: ColumnDef<Sensor, unknown>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: (ctx) => <span className="truncate text-fg-100">{ctx.getValue<string>()}</span>,
  },
  {
    accessorKey: "tailnet_ip",
    header: "Tailnet IP",
    cell: (ctx) => <span className="font-mono text-xs text-fg-80">{ctx.getValue<string>()}</span>,
    size: 180,
  },
  {
    accessorKey: "version",
    header: "Version",
    cell: (ctx) => <span className="font-mono text-xs text-fg-60">{ctx.getValue<string>()}</span>,
    size: 100,
  },
  {
    id: "capabilities",
    header: "Capabilities",
    cell: (ctx) => {
      const caps = ctx.row.original.capabilities ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {caps.slice(0, 3).map((c) => (
            <Badge key={c} tone="neutral" outline>
              {c.replace(/_/g, " ")}
            </Badge>
          ))}
          {caps.length > 3 && <span className="text-2xs text-fg-60">+{caps.length - 3}</span>}
        </div>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    cell: (ctx) => <LiveDot state={sensorStatus(ctx.row.original)} />,
    size: 140,
  },
  {
    accessorKey: "last_seen",
    header: "Last seen",
    cell: (ctx) => {
      const value = ctx.getValue<string | undefined>();
      return value ? <RelativeTime value={value} /> : <span className="text-fg-40">—</span>;
    },
    size: 110,
  },
];

export function SensorsView(): JSX.Element {
  const navigate = useNavigate();
  const search: { id?: string; q?: string } = useSearch({ strict: false });
  const query = useSensorsList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = useMemo(
    () => (search.id ? items.find((s) => s.id === search.id) : undefined),
    [search.id, items],
  );

  const open = (sensor: Sensor): void => {
    void navigate({ to: "/sensors", search: { q: search.q, id: sensor.id } });
  };
  const close = (): void => {
    void navigate({ to: "/sensors", search: { q: search.q } });
  };

  if (query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Sensors" />
        <EmptyState
          title="Admin + 2FA required"
          description="Sensor inventory is gated. Sign in as an admin and complete TOTP verification to view this list."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sensors"
        total={query.data?.total}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Filter by name, IP, capability…",
        }}
      />

      <DataTable<Sensor>
        data={items}
        columns={columns}
        globalFilter={searchTerm}
        onRowOpen={open}
        getRowId={(row) => row.id}
        label="Sensors"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No sensors connected yet"
            description="Run the install snippet on your Pi to bring your first sensor online."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        title={
          <div className="flex items-center gap-3">
            <span className="truncate font-mono">{selected?.name ?? search.id ?? ""}</span>
            {selected && <LiveDot state={sensorStatus(selected)} />}
          </div>
        }
      >
        {selected ? (
          <SensorDetail sensor={selected} />
        ) : (
          <EmptyState title="Sensor not found in this page" />
        )}
      </Drawer>
    </div>
  );
}

function SensorDetail({ sensor }: { sensor: Sensor }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Section label="Identity">
        <Row k="ID" v={<span className="font-mono text-xs text-fg-80">{sensor.id}</span>} />
        <Row k="Name" v={sensor.name} />
        <Row
          k="Tailnet IP"
          v={<span className="font-mono text-xs text-fg-80">{sensor.tailnet_ip}</span>}
        />
        <Row
          k="Version"
          v={<span className="font-mono text-xs text-fg-80">{sensor.version}</span>}
        />
        <Row
          k="Revoked"
          v={
            <Badge tone={sensor.revoked ? "red" : "green"} outline>
              {sensor.revoked ? "yes" : "no"}
            </Badge>
          }
        />
      </Section>

      <Section label="Capabilities">
        <div className="flex flex-wrap gap-1.5">
          {(sensor.capabilities ?? []).map((c) => (
            <Badge key={c} tone="neutral" outline>
              {c.replace(/_/g, " ")}
            </Badge>
          ))}
          {(sensor.capabilities ?? []).length === 0 && (
            <span className="text-xs text-fg-60">No capabilities advertised yet.</span>
          )}
        </div>
      </Section>

      <Section label="Last seen">
        <div className="text-sm text-fg-100">
          {sensor.last_seen ? (
            <RelativeTime value={sensor.last_seen} />
          ) : (
            <span className="text-fg-40">never</span>
          )}
        </div>
      </Section>

      <Section label="Coming in Stage 7">
        <p className="text-xs text-fg-60">
          Live event console, channel hop schedule, and 24-hour uptime sparkline land alongside the
          active-module gating work.
        </p>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-2xs uppercase tracking-wide text-fg-60">{label}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 text-sm">
      <div className="text-xs text-fg-60">{k}</div>
      <div className="text-fg-100">{v}</div>
    </div>
  );
}
