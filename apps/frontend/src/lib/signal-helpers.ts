import type { components } from "@/services/api/openapi";

type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];

/**
 * Anything with a `signal_history` array of RSSI samples — both
 * `AccessPoint` and `Client` schemas share this shape.
 */
type HasSignalHistory = Pick<AccessPoint, "signal_history"> | Pick<Client, "signal_history">;

/**
 * Most recent RSSI in dBm, or `null` when no samples are recorded.
 *
 * Used by the AP / device list columns and detail drawers to render
 * a `SignalBars` indicator at a glance.
 */
export function latestRssi(entity: HasSignalHistory): number | null {
  const samples = entity.signal_history ?? [];
  if (samples.length === 0) return null;
  const last = samples[samples.length - 1];
  return last && typeof last.rssi_dbm === "number" ? last.rssi_dbm : null;
}

/**
 * Filtered timeseries of RSSI dBm values, oldest → newest. Skips
 * malformed samples so charts don't have to defend against `undefined`.
 */
export function rssiSeries(entity: HasSignalHistory): number[] {
  return (entity.signal_history ?? [])
    .map((s) => s.rssi_dbm)
    .filter((n): n is number => typeof n === "number");
}
