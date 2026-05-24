import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { EncryptionChip } from "@/components/domain/EncryptionChip";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { OnDemandInsight } from "@/components/insights/OnDemandInsight";
import { latestRssi, rssiSeries } from "@/lib/signal-helpers";
import { resolveVendor } from "@/lib/vendor";
import {
  type AccessPoint,
  type Client,
  useAccessPointDetail,
  useApAssociatedClients,
} from "@/services/api/queries";

interface AccessPointDetailProps {
  bssid: string;
  /**
   * Optional list-row data used as an instant placeholder while the
   * detail query loads. When the operator clicks a row we already have
   * everything visible on the table, so blocking on the network round-
   * trip would feel slow for no benefit.
   */
  seed?: AccessPoint;
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

/**
 * Access-point detail drawer body. Backed by
 * `GET /api/v1/access_points/{bssid}`.
 *
 * The detail query is the source of truth so deep-links work even when
 * the BSSID isn't in the cached list page. When the row is already
 * cached (operator clicked from the table) we hand it in as `seed` and
 * render instantly, upgrading to the fresher detail payload (longer
 * signal history, latest associations) when it arrives.
 *
 * 404 → "AP not yet observed" empty state; 401/403 → "Sign in required"
 * state. Other failures fall through to a generic error so we don't
 * lie about what happened.
 */
export function AccessPointDetail({ bssid, seed }: AccessPointDetailProps): JSX.Element {
  const query = useAccessPointDetail(bssid);
  const ap = query.data ?? seed;

  // `seed` wins over the empty-state surfaces. If the operator already
  // saw the row in the table, a momentary 404 (AP rolled out of the
  // backend's hot window between list + detail fetch) shouldn't wipe
  // the drawer — they clicked it, it was real. Errors only matter when
  // there's no row at all (i.e. a deep-link from outside the app).
  if (!ap) {
    if (query.error?.status === 404) {
      return (
        <EmptyState
          title="Not seen yet"
          description="This BSSID isn't in the live store. Once a sensor observes it, its details will appear here."
        />
      );
    }
    if (query.error?.status === 401 || query.error?.status === 403) {
      return (
        <EmptyState
          title="Sign in required"
          description="The AP detail endpoint refused this request. Sign in again to refresh your session."
        />
      );
    }
    if (query.error) {
      return <EmptyState title="Unable to load AP" description={query.error.message} />;
    }
    return (
      <div className="flex flex-col gap-3" data-testid="ap-detail-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const dbm = latestRssi(ap);
  const series = rssiSeries(ap);
  return (
    <div className="flex flex-col gap-5" data-testid="ap-detail">
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
          value={<MacAddress value={ap.bssid} vendor={resolveVendor(ap)} hideInlineVendor />}
        />
        <DetailRow
          label="Vendor"
          value={resolveVendor(ap) ?? <span className="text-fg-40">unknown</span>}
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

      <DetailSection label="Activity">
        <DetailRow
          label="First seen"
          value={
            ap.first_seen ? (
              <RelativeTime value={ap.first_seen} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <DetailRow
          label="Last seen"
          value={
            ap.last_seen ? (
              <RelativeTime value={ap.last_seen} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
      </DetailSection>

      <DetailSection label="Signal history">
        <div className="rounded-sm border border-fg-20 bg-bg-inset p-3">
          <SignalSparkline samples={series} width={420} height={48} />
        </div>
      </DetailSection>

      <AssociatedClients bssid={ap.bssid} />

      <OnDemandInsight kind="ap_description" entityId={ap.bssid} buttonLabel="Explain this AP" />
    </div>
  );
}

/**
 * Associated-clients sub-list inside the AP drawer. Backed by
 * `GET /api/v1/access_points/{bssid}/clients`. Renders a compact,
 * scrollable list rather than a full DataTable — the AP drawer already
 * lives in a narrow column.
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
  const vendor = resolveVendor(client);
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <MacAddress value={client.mac} vendor={vendor} truncate hideInlineVendor />
        {vendor && <span className="truncate text-2xs text-fg-60">{vendor}</span>}
      </div>
      {dbm !== null ? <SignalBars dbm={dbm} /> : <span className="text-fg-40">—</span>}
      {client.last_seen && <RelativeTime value={client.last_seen} />}
    </li>
  );
}
