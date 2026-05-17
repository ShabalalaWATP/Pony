import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { latestRssi, rssiSeries } from "@/lib/signal-helpers";
import { useDevicesList, type Client } from "@/services/api/queries";

const columns: ColumnDef<Client, unknown>[] = [
  {
    accessorKey: "mac",
    header: "MAC",
    cell: (ctx) => (
      <MacAddress
        value={ctx.getValue<string>()}
        vendor={ctx.row.original.vendor_oui ?? undefined}
      />
    ),
    size: 220,
  },
  {
    accessorKey: "vendor_oui",
    header: "Vendor",
    cell: (ctx) => {
      const v = ctx.getValue<string | null>();
      return v ? (
        <span className="text-fg-100">{v}</span>
      ) : (
        <span className="text-fg-40">unknown</span>
      );
    },
    size: 160,
  },
  {
    id: "probes",
    header: "Probes",
    cell: (ctx) => {
      const probes = ctx.row.original.probes ?? [];
      return <span className="font-mono text-xs text-fg-80 tabular-nums">{probes.length}</span>;
    },
    size: 80,
  },
  {
    accessorKey: "associated_bssid",
    header: "Associated AP",
    cell: (ctx) => {
      const bssid = ctx.getValue<string | null>();
      return bssid ? <MacAddress value={bssid} truncate /> : <span className="text-fg-40">—</span>;
    },
    size: 200,
  },
  {
    id: "rssi",
    header: "RSSI",
    cell: (ctx) => {
      const dbm = latestRssi(ctx.row.original);
      return dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>;
    },
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

/**
 * Clients (WiFi devices) list view: every probe-emitting or
 * associated device the sensors have observed. Detail drawer is
 * deep-linkable via `?mac=`. Stage 6 (analysis pack) will add
 * per-AP association timelines and the watch-this-device rule helper.
 */
export function DevicesView(): JSX.Element {
  const navigate = useNavigate();
  const search: { mac?: string; q?: string } = useSearch({ strict: false });
  const query = useDevicesList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = useMemo(
    () => (search.mac ? items.find((c) => c.mac === search.mac) : undefined),
    [search.mac, items],
  );

  const open = (c: Client): void => {
    void navigate({ to: "/devices", search: { q: search.q, mac: c.mac } });
  };
  const close = (): void => {
    void navigate({ to: "/devices", search: { q: search.q } });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Devices"
        total={query.data?.total}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Filter by MAC, vendor, AP…",
        }}
      />

      <DataTable<Client>
        data={items}
        columns={columns}
        globalFilter={searchTerm}
        onRowOpen={open}
        getRowId={(row) => row.mac}
        label="Clients"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No clients observed yet"
            description="Devices show up as soon as a sensor sees probe requests or association frames."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        title={
          <div className="flex items-center gap-3 truncate">
            <MacAddress value={selected?.mac ?? search.mac ?? ""} />
          </div>
        }
      >
        {selected ? (
          <DeviceDetail client={selected} />
        ) : (
          <EmptyState title="Device not in current page" />
        )}
      </Drawer>
    </div>
  );
}

function DeviceDetail({ client }: { client: Client }): JSX.Element {
  const dbm = latestRssi(client);
  const series = rssiSeries(client);
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="MAC"
          value={<MacAddress value={client.mac} vendor={client.vendor_oui ?? undefined} />}
        />
        <DetailRow
          label="Vendor"
          value={client.vendor_oui ?? <span className="text-fg-40">unknown</span>}
        />
        <DetailRow
          label="Associated AP"
          value={
            client.associated_bssid ? (
              <MacAddress value={client.associated_bssid} />
            ) : (
              <span className="text-fg-40">none</span>
            )
          }
        />
      </DetailSection>

      <DetailSection label="Probes">
        {(client.probes ?? []).length === 0 ? (
          <span className="text-xs text-fg-60">No probes captured yet.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(client.probes ?? []).map((p) => (
              <code
                key={p}
                className="rounded-xs border border-fg-20 bg-bg-inset px-1.5 py-0.5 font-mono text-2xs text-fg-80"
              >
                {p}
              </code>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection label="Signal">
        <div className="flex items-center gap-3">
          {dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>}
        </div>
        {series.length > 0 && (
          <div className="rounded-sm border border-fg-20 bg-bg-inset p-3">
            <SignalSparkline samples={series} width={420} height={48} />
          </div>
        )}
      </DetailSection>

      <DetailSection label="Activity">
        <DetailRow
          label="First seen"
          value={
            client.first_seen ? (
              <RelativeTime value={client.first_seen} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <DetailRow
          label="Last seen"
          value={
            client.last_seen ? (
              <RelativeTime value={client.last_seen} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
      </DetailSection>

      <DetailSection label="Coming in Stage 6">
        <p className="text-xs text-fg-60">
          Per-AP association timeline and a one-click "Watch this device" alert rule arrive with the
          analysis pack.
        </p>
      </DetailSection>
    </div>
  );
}
