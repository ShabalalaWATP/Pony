import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { AnomalyBadge } from "@/components/domain/AnomalyBadge";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { EncryptionChip } from "@/components/domain/EncryptionChip";
import { LabelBadge } from "@/components/domain/LabelBadge";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SsidLabel } from "@/components/domain/SsidLabel";
import type { components } from "@/services/api/openapi";
import type { ApType } from "@/lib/labels";

type AnomalyContribution = components["schemas"]["AnomalyContribution"];
import { latestRssi } from "@/lib/signal-helpers";
import { resolveVendor } from "@/lib/vendor";
import { useAccessPointsList, type AccessPoint } from "@/services/api/queries";
import { AccessPointDetail } from "./AccessPointDetail";

const columns: ColumnDef<AccessPoint, unknown>[] = [
  {
    accessorKey: "ssid",
    header: "SSID",
    cell: (ctx) => <SsidLabel ssid={ctx.getValue<string | null>()} truncate />,
  },
  {
    accessorKey: "bssid",
    header: "BSSID",
    cell: (ctx) => (
      <MacAddress value={ctx.getValue<string>()} vendor={resolveVendor(ctx.row.original)} />
    ),
    size: 240,
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
    id: "label",
    header: "Type",
    accessorFn: (row) => (row as AccessPoint & { label?: ApType | null }).label ?? "unknown",
    cell: (ctx) => {
      const row = ctx.row.original as AccessPoint & {
        label?: ApType | null;
        label_confidence?: number;
      };
      return <LabelBadge kind="ap" label={row.label} confidence={row.label_confidence} />;
    },
    size: 120,
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
    id: "anomaly",
    header: "Anomaly",
    accessorFn: (row) => (row as AccessPoint & { anomaly_score?: number }).anomaly_score ?? 0,
    cell: (ctx) => {
      const row = ctx.row.original as AccessPoint & {
        anomaly_score?: number;
        anomaly_reasons?: AnomalyContribution[];
      };
      return (
        <AnomalyBadge score={row.anomaly_score ?? 0} reasons={row.anomaly_reasons} hideScore />
      );
    },
    size: 130,
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
 * `?bssid=`.
 *
 * The drawer body itself fetches `GET /access_points/{bssid}` so a
 * deep-link from outside (or after the list page rolls over) still
 * resolves. When the BSSID is in the current list page we pass the
 * row in as `seed` for an instant render while the detail loads.
 */
export function NetworksView(): JSX.Element {
  const navigate = useNavigate();
  const search: { bssid?: string; q?: string } = useSearch({ strict: false });
  const query = useAccessPointsList({ limit: 500 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const seed = useMemo(
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
      >
        <Button asChild variant="ghost" size="sm">
          <Link to="/networks/evil-twins" data-testid="evil-twin-link">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Evil-twin candidates
          </Link>
        </Button>
      </PageHeader>

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
        open={Boolean(search.bssid)}
        onClose={close}
        title={
          <div className="flex items-center gap-3 truncate">
            <SsidLabel ssid={seed?.ssid} truncate className="font-mono" />
            <MacAddress value={seed?.bssid ?? search.bssid ?? ""} truncate />
          </div>
        }
      >
        {search.bssid ? <AccessPointDetail bssid={search.bssid} seed={seed} /> : null}
      </Drawer>
    </div>
  );
}
