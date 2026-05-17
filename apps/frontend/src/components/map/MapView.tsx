import { MapPin as MapPinIcon, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { useAccessPointsList, type AccessPoint } from "@/services/api/queries";
import { type MapPin, useMapPinsStore } from "@/stores/useMapPinsStore";

const MapCanvas = lazy(() => import("./MapCanvas").then((m) => ({ default: m.MapCanvas })));

interface Pending {
  bssid: string;
  label: string;
}

/**
 * Map of operator-located access points.
 *
 * Two layers contribute markers, in precedence order:
 *
 *   1. **Operator pins** (localStorage, keyed by BSSID) — the operator
 *      override. Always wins so manual corrections stick.
 *   2. **Server-side coords** — APs with `latitude`/`longitude` set by
 *      a GPS-capable sensor (or back-filled later by WiGLE etc.).
 *
 * Manual placement remains for APs the backend can't geolocate yet:
 * select an AP in the sidebar, click on the map. Clicking a manual pin
 * removes it; clicking a server-located pin is a no-op (there's
 * nothing for the operator to remove — it's authoritative data).
 */
export function MapView(): JSX.Element {
  const query = useAccessPointsList({ limit: 500 });
  const manualPins = useMapPinsStore((s) => s.pins);
  const setPin = useMapPinsStore((s) => s.setPin);
  const removePin = useMapPinsStore((s) => s.removePin);
  const clear = useMapPinsStore((s) => s.clear);

  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const filtered = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter(
      (ap) =>
        ap.bssid.toLowerCase().includes(lower) ||
        (ap.ssid ?? "").toLowerCase().includes(lower) ||
        (ap.vendor_oui ?? "").toLowerCase().includes(lower),
    );
  }, [items, filter]);

  // Merge the two layers — manual pins always override server coords.
  const { mergedPins, serverPlaced } = useMemo(() => {
    const merged: Record<string, MapPin> = {};
    const server = new Set<string>();
    for (const ap of items) {
      if (ap.latitude == null || ap.longitude == null) continue;
      const key = ap.bssid.toLowerCase();
      merged[key] = { lat: ap.latitude, lng: ap.longitude };
      server.add(key);
    }
    for (const [bssid, pin] of Object.entries(manualPins)) {
      merged[bssid] = pin;
      server.delete(bssid); // operator override wins
    }
    return { mergedPins: merged, serverPlaced: server };
  }, [items, manualPins]);

  const onMapClick = (lngLat: { lng: number; lat: number }): void => {
    if (!pending) return;
    setPin(pending.bssid, { lat: lngLat.lat, lng: lngLat.lng });
    setPending(null);
  };
  const onPinClick = (bssid: string): void => {
    const key = bssid.toLowerCase();
    if (serverPlaced.has(key)) return;
    if (window.confirm(`Remove pin for ${bssid}?`)) removePin(bssid);
  };

  const manualCount = Object.keys(manualPins).length;
  const serverCount = serverPlaced.size;
  const pinCount = Object.keys(mergedPins).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Map" total={pinCount}>
        <div className="flex items-center gap-2">
          {serverCount > 0 && (
            <Badge tone="accent" outline>
              <MapPinIcon className="size-3" aria-hidden="true" />
              {serverCount} from sensors
            </Badge>
          )}
          {manualCount > 0 && (
            <Badge tone="neutral" outline>
              {manualCount} manual
            </Badge>
          )}
          {manualCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm("Remove every manual pin?")) clear();
              }}
            >
              Clear manual pins
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-2 rounded-md border border-fg-20 bg-bg-2 p-3">
          <div className="text-2xs uppercase tracking-wide text-fg-60">Access points</div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter SSID / BSSID / vendor"
            className="h-8 text-xs"
          />
          {pending && <PendingChip pending={pending} onCancel={() => setPending(null)} />}
          <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 480 }}>
            {filtered.length === 0 && (
              <span className="px-1 py-3 text-xs text-fg-60">No matches.</span>
            )}
            {filtered.map((ap) => {
              const key = ap.bssid.toLowerCase();
              const placed = Boolean(mergedPins[key]);
              const fromSensor = serverPlaced.has(key);
              return (
                <ApRow
                  key={ap.bssid}
                  ap={ap}
                  placed={placed}
                  fromSensor={fromSensor}
                  onPlace={() => setPending({ bssid: ap.bssid, label: ap.ssid ?? ap.bssid })}
                />
              );
            })}
          </div>
        </aside>

        <div className="relative h-[560px] overflow-hidden rounded-md border border-fg-20 bg-bg-2">
          {query.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : items.length === 0 ? (
            <EmptyState
              title="No access points to place yet"
              description="Bring a sensor online; APs appear here as soon as the first capture lands."
            />
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <MapCanvas
                pins={mergedPins}
                pending={pending}
                onMapClick={onMapClick}
                onPinClick={onPinClick}
              />
            </Suspense>
          )}
          {pending && (
            <div
              className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-sm border border-mode/40 bg-bg-2/90 px-3 py-1.5 text-xs text-mode shadow-lg"
              role="status"
            >
              Click on the map to place a pin for {pending.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ApRowProps {
  ap: AccessPoint;
  placed: boolean;
  fromSensor: boolean;
  onPlace: () => void;
}

function ApRow({ ap, placed, fromSensor, onPlace }: ApRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPlace}
      data-testid="map-ap-row"
      className="flex flex-col gap-1 rounded-sm border border-fg-20 bg-bg-1 px-2 py-1.5 text-left hover:border-fg-40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-fg-100">
          {ap.ssid ?? <span className="italic text-fg-40">&lt;hidden&gt;</span>}
        </span>
        {placed && (
          <Badge tone={fromSensor ? "accent" : "neutral"} outline>
            <MapPinIcon className="size-3" aria-hidden="true" />
            {fromSensor ? "from sensor" : "placed"}
          </Badge>
        )}
      </div>
      <MacAddress value={ap.bssid} vendor={ap.vendor_oui ?? undefined} truncate />
    </button>
  );
}

function PendingChip({
  pending,
  onCancel,
}: {
  pending: Pending;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-mode/40 bg-mode/10 px-2 py-1.5 text-xs text-mode">
      <MapPinIcon className="size-3" aria-hidden="true" />
      <span className="flex-1 truncate">Placing: {pending.label}</span>
      <button type="button" onClick={onCancel} aria-label="Cancel placement">
        <X className="size-3" />
      </button>
    </div>
  );
}
