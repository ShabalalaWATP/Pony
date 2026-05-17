import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { EncryptionChip } from "@/components/domain/EncryptionChip";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { useAccessPointsList, type AccessPoint } from "@/services/api/queries";

function latestRssi(ap: AccessPoint): number | null {
  const samples = ap.signal_history ?? [];
  if (samples.length === 0) return null;
  const last = samples[samples.length - 1];
  return last && typeof last.rssi_dbm === "number" ? last.rssi_dbm : null;
}

function rssiSeries(ap: AccessPoint): number[] {
  return (ap.signal_history ?? [])
    .map((s) => s.rssi_dbm)
    .filter((n): n is number => typeof n === "number");
}

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

function NetworkDetail({ ap }: { ap: AccessPoint }): JSX.Element {
  const dbm = latestRssi(ap);
  const series = rssiSeries(ap);
  return (
    <div className="flex flex-col gap-5">
      <Section label="Identity">
        <Row
          k="SSID"
          v={
            ap.ssid ? (
              <span className="font-mono">{ap.ssid}</span>
            ) : (
              <span className="italic text-fg-40">&lt;hidden&gt;</span>
            )
          }
        />
        <Row k="BSSID" v={<MacAddress value={ap.bssid} vendor={ap.vendor_oui ?? undefined} />} />
        <Row k="Vendor" v={ap.vendor_oui ?? <span className="text-fg-40">unknown</span>} />
      </Section>

      <Section label="Radio">
        <Row
          k="Channel"
          v={
            ap.channel ? (
              <ChannelBadge channel={ap.channel} band={ap.band ?? undefined} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <Row k="Encryption" v={<EncryptionChip encryption={ap.encryption?.[0] ?? "OPEN"} />} />
        <Row
          k="Latest RSSI"
          v={dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>}
        />
      </Section>

      <Section label="Signal history">
        <div className="rounded-sm border border-fg-20 bg-bg-inset p-3">
          <SignalSparkline samples={series} width={420} height={48} />
        </div>
      </Section>

      <Section label="Coming in Stage 6/8">
        <p className="text-xs text-fg-60">
          Associated clients sub-list, probe responses, raw frame samples and a PCAP export action
          arrive with the packet inspector + reporting work.
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
