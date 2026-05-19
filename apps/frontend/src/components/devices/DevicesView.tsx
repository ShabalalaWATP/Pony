import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { latestRssi } from "@/lib/signal-helpers";
import { useDevicesList, type Client } from "@/services/api/queries";
import { DeviceDetail } from "./DeviceDetail";

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
 * deep-linkable via `?mac=` and resolves through
 * `GET /api/v1/devices/{mac}`, so a link from outside still loads
 * even when the MAC isn't on the visible list page.
 */
export function DevicesView(): JSX.Element {
  const navigate = useNavigate();
  const search: { mac?: string; q?: string } = useSearch({ strict: false });
  const query = useDevicesList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const seed = useMemo(
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
        open={Boolean(search.mac)}
        onClose={close}
        title={
          <div className="flex items-center gap-3 truncate">
            <MacAddress value={seed?.mac ?? search.mac ?? ""} />
          </div>
        }
      >
        {search.mac ? <DeviceDetail mac={search.mac} seed={seed} /> : null}
      </Drawer>
    </div>
  );
}
