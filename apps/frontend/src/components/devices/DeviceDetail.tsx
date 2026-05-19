import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { latestRssi, rssiSeries } from "@/lib/signal-helpers";
import { type Client, useDeviceDetail } from "@/services/api/queries";

interface DeviceDetailProps {
  mac: string;
  /** Optional list-row data for instant render while detail loads. */
  seed?: Client;
}

/**
 * Client (WiFi device) detail drawer body. Backed by
 * `GET /api/v1/devices/{mac}`.
 *
 * The detail query is the source of truth so deep-links work even when
 * the MAC isn't on the visible list page. When the row is already
 * cached we hand it in as `seed` and render instantly, upgrading to
 * the fresher payload when it arrives (longer probe history, more
 * signal samples).
 */
export function DeviceDetail({ mac, seed }: DeviceDetailProps): JSX.Element {
  const query = useDeviceDetail(mac);
  const client = query.data ?? seed;

  // `seed` wins over the empty-state surfaces — see the same comment in
  // `AccessPointDetail`. The operator just clicked the row; a transient
  // 404 shouldn't replace what they're looking at.
  if (!client) {
    if (query.error?.status === 404) {
      return (
        <EmptyState
          title="Not seen yet"
          description="This MAC isn't in the live store. Once a sensor observes it, its details will appear here."
        />
      );
    }
    if (query.error?.status === 401 || query.error?.status === 403) {
      return (
        <EmptyState
          title="Sign in required"
          description="The device detail endpoint refused this request. Sign in again to refresh your session."
        />
      );
    }
    if (query.error) {
      return <EmptyState title="Unable to load device" description={query.error.message} />;
    }
    return (
      <div className="flex flex-col gap-3" data-testid="device-detail-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const dbm = latestRssi(client);
  const series = rssiSeries(client);
  return (
    <div className="flex flex-col gap-5" data-testid="device-detail">
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
          <div className="flex flex-wrap gap-1.5" data-testid="device-probes">
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
    </div>
  );
}
