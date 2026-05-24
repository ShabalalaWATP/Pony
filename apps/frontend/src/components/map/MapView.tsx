import { useNavigate } from "@tanstack/react-router";
import { Info, MapPin as MapPinIcon, Sparkles, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { SsidLabel } from "@/components/domain/SsidLabel";
import { sensorStatus } from "@/lib/sensorStatus";
import { resolveVendor } from "@/lib/vendor";
import { useAccessPointsList, useSensorsList, type AccessPoint } from "@/services/api/queries";
import { type MapPin, useMapPinsStore } from "@/stores/useMapPinsStore";
import { useMapStyleStore } from "@/stores/useMapStyleStore";
import { MapStyleSwitcher } from "./MapStyleSwitcher";
import { styleDefFor } from "./mapStyles";
import type { SensorMarker } from "./MapCanvas";
import { SCATTER_CENTER, scatterFor } from "./scatter";

const MapCanvas = lazy(() => import("./MapCanvas").then((m) => ({ default: m.MapCanvas })));

interface Pending {
  bssid: string;
  label: string;
}

interface FlyTo {
  center: [number, number];
  zoom: number;
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
 *
 * Demo helper: when the backend has APs but none with geo coords
 * (current state of the demo seeder), the view surfaces a "Scatter
 * demo pins" affordance that drops manual pins in a deterministic
 * ring around `SCATTER_CENTER`. Lets the operator preview the map
 * UX without waiting on a GPS-capable sensor or a backend seeder
 * update.
 */
export function MapView(): JSX.Element {
  const query = useAccessPointsList({ limit: 500 });
  // Sensors render alongside APs when they carry coords (PR #56). The
  // hook is admin-gated server-side; a 403 just means the operator
  // can't see the sensor layer, so we degrade silently — APs still
  // render. Limit matches the Sensors view list cap.
  const sensorsQuery = useSensorsList({ limit: 500 });
  const navigate = useNavigate();
  const manualPins = useMapPinsStore((s) => s.pins);
  const setPin = useMapPinsStore((s) => s.setPin);
  const removePin = useMapPinsStore((s) => s.removePin);
  const clear = useMapPinsStore((s) => s.clear);
  const styleId = useMapStyleStore((s) => s.styleId);
  const styleSpec = useMemo(() => styleDefFor(styleId).style, [styleId]);

  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  // Build the renderable sensor-marker set — only sensors with both
  // lat AND lng become markers. `sensorStatus` is the shared helper
  // used by SensorsView so the live/stale/offline classification stays
  // consistent across the dashboard.
  const sensorMarkers = useMemo<Record<string, SensorMarker>>(() => {
    const out: Record<string, SensorMarker> = {};
    for (const s of sensorsQuery.data?.items ?? []) {
      if (s.latitude == null || s.longitude == null) continue;
      out[s.id] = {
        id: s.id,
        name: s.name,
        lat: s.latitude,
        lng: s.longitude,
        status: sensorStatus(s),
      };
    }
    return out;
  }, [sensorsQuery.data?.items]);

  const onSensorClick = (sensorId: string): void => {
    void navigate({ to: "/sensors", search: { id: sensorId } });
  };

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
  const { mergedPins, serverPlaced, unplacedBssids } = useMemo(() => {
    const merged: Record<string, MapPin> = {};
    const server = new Set<string>();
    const placed = new Set<string>();
    for (const ap of items) {
      if (ap.latitude == null || ap.longitude == null) continue;
      const key = ap.bssid.toLowerCase();
      merged[key] = { lat: ap.latitude, lng: ap.longitude };
      server.add(key);
      placed.add(key);
    }
    for (const [bssid, pin] of Object.entries(manualPins)) {
      merged[bssid] = pin;
      server.delete(bssid); // operator override wins
      placed.add(bssid);
    }
    const unplaced = items
      .map((ap) => ap.bssid.toLowerCase())
      .filter((bssid) => !placed.has(bssid));
    return { mergedPins: merged, serverPlaced: server, unplacedBssids: unplaced };
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

  const scatterUnplaced = (): void => {
    if (unplacedBssids.length === 0) return;
    for (const bssid of unplacedBssids) {
      setPin(bssid, scatterFor(bssid));
    }
    // Trigger a flyTo by passing a fresh object so MapCanvas re-runs
    // the camera effect. Zoom 10 is "city" — pins are clearly visible.
    setFlyTo({ center: SCATTER_CENTER, zoom: 10 });
  };

  const manualCount = Object.keys(manualPins).length;
  const serverCount = serverPlaced.size;
  const pinCount = Object.keys(mergedPins).length;
  const sensorCount = Object.keys(sensorMarkers).length;
  // Show the no-geo hint only when (a) APs exist, (b) none have server
  // coords, and (c) the operator hasn't already started placing pins
  // manually. Once they've started, the hint stops adding value.
  const showNoGeoHint =
    items.length > 0 && serverCount === 0 && manualCount === 0 && !query.isLoading;
  // Map should render the canvas when EITHER APs or sensors give us
  // something to display. Empty state is only correct when both sets
  // are empty (and we're not still loading).
  const canvasHasContent = items.length > 0 || sensorCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Map" total={pinCount}>
        <div className="flex items-center gap-2">
          {sensorCount > 0 && (
            <Badge tone="green" outline data-testid="map-sensor-count">
              {sensorCount} sensor{sensorCount === 1 ? "" : "s"}
            </Badge>
          )}
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
          <MapStyleSwitcher />
        </div>
      </PageHeader>

      {showNoGeoHint && (
        <NoGeoHint
          unplacedCount={unplacedBssids.length}
          onScatter={scatterUnplaced}
          data-testid="map-no-geo-hint"
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-2 rounded-md border border-fg-20 bg-bg-2 p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-2xs uppercase tracking-wide text-fg-60">Access points</div>
            <div className="text-2xs text-fg-40">click to place</div>
          </div>
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
          ) : !canvasHasContent ? (
            <EmptyState
              title="No access points or sensors to show yet"
              description="Bring a sensor online; APs and sensor positions appear here as soon as the first capture lands."
            />
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <MapCanvas
                pins={mergedPins}
                style={styleSpec}
                pending={pending}
                flyTo={flyTo}
                sensorMarkers={sensorMarkers}
                onMapClick={onMapClick}
                onPinClick={onPinClick}
                onSensorClick={onSensorClick}
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

interface NoGeoHintProps {
  unplacedCount: number;
  onScatter: () => void;
  "data-testid"?: string;
}

/**
 * Banner shown when APs are loaded but none carry GPS coordinates.
 * Today this is the normal state for the demo dataset — the seeder
 * populates BSSIDs, SSIDs, channels and signal history but not
 * latitude/longitude. Tells the operator (a) why the map looks empty,
 * (b) that they can drop manual pins by clicking sidebar rows, and
 * (c) gives them a one-click "Scatter" affordance so they can see the
 * UX with a populated map straight away.
 */
function NoGeoHint({
  unplacedCount,
  onScatter,
  "data-testid": testId,
}: NoGeoHintProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-md border border-mode/30 bg-mode/5 p-3 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-mode" aria-hidden="true" />
      <div className="flex-1 text-fg-80">
        <div className="font-medium text-fg-100">No GPS coordinates on these access points yet</div>
        <div className="mt-0.5 text-xs text-fg-60">
          The demo seeder doesn&apos;t populate latitude/longitude — sensors will once a GPS dongle
          is attached. Until then, click any AP in the sidebar then click the map to drop a manual
          pin, or scatter all {unplacedCount} unplaced APs around a demo center.
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={onScatter}
        data-testid="map-scatter-demo-pins"
        aria-label={`Scatter ${unplacedCount} unplaced access points as demo pins`}
      >
        <Sparkles className="size-3.5" aria-hidden="true" />
        Scatter demo pins
      </Button>
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
  // We can't wrap the whole row in a <button> — `MacAddress` already
  // renders its own click-to-copy <button>, and nesting buttons is
  // invalid HTML and triggers a React warning. Instead, the "place pin"
  // affordance is the SSID line at the top of the row; the BSSID below
  // keeps its own copy button at the leaf.
  return (
    <div
      data-testid="map-ap-row"
      className="flex flex-col gap-1 rounded-sm border border-fg-20 bg-bg-1 px-2 py-1.5 hover:border-fg-40"
    >
      <button
        type="button"
        onClick={onPlace}
        aria-label={`Place pin for ${ap.ssid ?? ap.bssid}`}
        className="flex items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mode"
      >
        <SsidLabel ssid={ap.ssid} truncate className="text-sm" />
        {placed && (
          <Badge tone={fromSensor ? "accent" : "neutral"} outline>
            <MapPinIcon className="size-3" aria-hidden="true" />
            {fromSensor ? "from sensor" : "placed"}
          </Badge>
        )}
      </button>
      <MacAddress value={ap.bssid} vendor={resolveVendor(ap)} truncate />
    </div>
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
