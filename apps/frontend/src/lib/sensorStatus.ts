import type { components } from "@/services/api/openapi";

type Sensor = components["schemas"]["Sensor"];

/** Operator-visible health state of a sensor. */
export type SensorStatus = "live" | "stale" | "offline";

/**
 * Derive a sensor's live/stale/offline state from its `last_seen`
 * timestamp and `revoked` flag.
 *
 * Thresholds match the live-data UX rules in the design spec (§9):
 * - revoked → offline
 * - never seen → offline
 * - <30s since last_seen → live
 * - <5m since last_seen → stale
 * - otherwise → offline
 *
 * Pure function — used by `SensorsView`, `MapView`, and any future
 * surface that renders sensor health, so the classification is
 * authoritative in one place.
 */
export function sensorStatus(s: Pick<Sensor, "revoked" | "last_seen">): SensorStatus {
  if (s.revoked) return "offline";
  if (!s.last_seen) return "offline";
  const age = Date.now() - new Date(s.last_seen).getTime();
  if (age < 30_000) return "live";
  if (age < 5 * 60_000) return "stale";
  return "offline";
}
