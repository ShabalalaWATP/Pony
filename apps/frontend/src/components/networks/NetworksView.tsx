import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { EncryptionChip } from "@/components/domain/EncryptionChip";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { Skeleton } from "@/components/ui/Skeleton";
import { latestRssi, rssiSeries } from "@/lib/signal-helpers";
import {
  useAccessPointsList,
  useApAssociatedClients,
  type AccessPoint,
  type Client,
} from "@/services/api/queries";

const columns: ColumnDef<AccessPoint, unknown>[] = [
  {
    accessorKey: "ssid",
    header: "SSID",
    cell: (ctx) => {
      const ssid = ctx.getValue<string | null>();
      return ssid ? (
        <span className="truncate text-fg-100">{ssid}</span>
      ) : (
        <span className="italic text-fg-40">&lt;hidden&gt;</span>
      );
    },
  },
  {
    accessorKey: "bssid",
    header: "BSSID",
    cell: (ctx) => (
      <MacAddress
        value={ctx.getValue<string>()}
        vendor={ctx.row.original.vendor_oui ?? undefined}
      />
    ),
    size: 200,
  },
  {
    accessorKey: "channel",
    header: "Channel",
    cell: (ctx) => {
      const channel = ctx.getValue<number | null>();
      const band = ctx.row.original.band ?? undefined;
      return channel ? (
        <ChannelBadge channel={channel} band={band ?? undefined} />
      ) : (
        <span className="text-fg-40">—</span>
      );
    },
    size: 140,
  },
  {
    id: "encryption",
    header: "Encryption",
    cell: (ctx) => {
      const enc = ctx.row.original.encryption?.[0];
      return enc ? <EncryptionChip encryption={enc} /> : <EncryptionChip encryption="OPEN" />;
    },
    size: 120,
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
 * Access-points list view: every AP the sensors have observed, sortable
 * by every column, with a deep-linkable detail drawer driven by
 * `?bssid=`. Stage 6 (packet inspector) will add the associated-clients
 * sub-list and the PCAP export action to the drawer.
 */
export function NetworksView(): JSX.Element {
  const navigate = useNavigate();
  const search: { bssid?: string; q?: string } = useSearch({ strict: false });
  const query = useAccessPointsList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = useMemo(
    () => (search.bssid ? items.find((a) => a.bssid === search.bssid) : undefined),
    [search.bssid, items],
  );

  const open = (ap: AccessPoint): void => {
    void navigate({ to: "/networks", search: { q: search.q, bssid: ap.bssid } });
  };
  const close = (): void => {
    void navigate({ to: "/networks", search: { q: search.q } });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Networks"
        total={query.data?.total}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Filter by SSID, BSSID, vendor…",
        }}
      />

      <DataTable<AccessPoint>
        data={items}
        columns={columns}
        globalFilter={searchTerm}
        onRowOpen={open}
        getRowId={(row) => row.bssid}
        label="Access points"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No access points captured yet"
            description="Start a sensor and APs surface here as soon as they're observed."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        title={
          <div className="flex items-center gap-3 truncate">
            <span className="truncate font-mono">{selected?.ssid ?? "<hidden>"}</span>
            <MacAddress value={selected?.bssid ?? search.bssid ?? ""} truncate />
          </div>
        }
      >
        {selected ? <NetworkDetail ap={selected} /> : <EmptyState title="AP not in current page" />}
      </Drawer>
    </div>
  );
}

const LOCATION_SOURCE_LABEL: Record<NonNullable<AccessPoint["location_source"]>, string> = {
  sensor_gps: "Sensor GPS",
  wigle: "WiGLE",
  manual: "Manual",
};

function formatLocation(ap: AccessPoint): JSX.Element {
  if (ap.latitude == null || ap.longitude == null) {
    return <span className="text-fg-40">unlocated</span>;
  }
  const source = ap.location_source ? LOCATION_SOURCE_LABEL[ap.location_source] : "unknown";
  return (
    <span className="font-mono text-xs text-fg-80">
      {ap.latitude.toFixed(5)}, {ap.longitude.toFixed(5)}
      <span className="ml-2 text-2xs text-fg-60">({source})</span>
    </span>
  );
}

function NetworkDetail({ ap }: { ap: AccessPoint }): JSX.Element {
  const dbm = latestRssi(ap);
  const series = rssiSeries(ap);
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="SSID"
          value={
            ap.ssid ? (
              <span className="font-mono">{ap.ssid}</span>
            ) : (
              <span className="italic text-fg-40">&lt;hidden&gt;</span>
            )
          }
        />
        <DetailRow
          label="BSSID"
          value={<MacAddress value={ap.bssid} vendor={ap.vendor_oui ?? undefined} />}
        />
        <DetailRow
          label="Vendor"
          value={ap.vendor_oui ?? <span className="text-fg-40">unknown</span>}
        />
        <DetailRow label="Location" value={formatLocation(ap)} />
      </DetailSection>

      <DetailSection label="Radio">
        <DetailRow
          label="Channel"
          value={
            ap.channel ? (
              <ChannelBadge channel={ap.channel} band={ap.band ?? undefined} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <DetailRow
          label="Encryption"
          value={<EncryptionChip encryption={ap.encryption?.[0] ?? "OPEN"} />}
        />
        <DetailRow
          label="Latest RSSI"
          value={dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>}
        />
      </DetailSection>

      <DetailSection label="Signal history">
        <div className="rounded-sm border border-fg-20 bg-bg-inset p-3">
          <SignalSparkline samples={series} width={420} height={48} />
        </div>
      </DetailSection>

      <AssociatedClients bssid={ap.bssid} />
    </div>
  );
}

/**
 * Associated-clients sub-list inside the AP drawer. Backed by
 * `GET /api/v1/access_points/{bssid}/clients` via
 * `useApAssociatedClients`. Renders a compact, scrollable list rather
 * than a full DataTable — the AP drawer already lives in a narrow
 * column, and tables that wide here would clip on 1080p.
 */
function AssociatedClients({ bssid }: { bssid: string }): JSX.Element {
  const query = useApAssociatedClients(bssid, { limit: 50 });
  const items = query.data?.items ?? [];

  return (
    <DetailSection label="Associated clients">
      {query.isLoading ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <p className="text-xs text-fg-60">Unable to load associated clients.</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-fg-60">No clients are currently associated with this AP.</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset"
          data-testid="ap-associated-clients"
        >
          {items.map((client) => (
            <AssociatedClientRow key={client.mac} client={client} />
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

function AssociatedClientRow({ client }: { client: Client }): JSX.Element {
  const dbm = latestRssi(client);
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <MacAddress value={client.mac} vendor={client.vendor_oui ?? undefined} truncate />
        {client.vendor_oui && (
          <span className="truncate text-2xs text-fg-60">{client.vendor_oui}</span>
        )}
      </div>
      {dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>}
      {client.last_seen && <RelativeTime value={client.last_seen} />}
    </li>
  );
}
