import type { MapPin } from "@/stores/useMapPinsStore";

/**
 * Demo "Scatter" center. Picked as a recognisable mid-latitude spot
 * rather than (0,0) (which is in the Atlantic and looks empty).
 * Manual pins land in a ~30 km radius around this point. Once the
 * backend seeder populates synthetic AP coords (it now does — see
 * PR #56) operators can clear these and rely on the server layer.
 */
export const SCATTER_CENTER: [number, number] = [-0.1278, 51.5074]; // [lng, lat]
export const SCATTER_RADIUS_DEGREES = 0.3; // ≈ 30 km of jitter per axis.

/**
 * Stable 32-bit FNV-1a hash of an arbitrary string. Used to spread
 * the demo scatter deterministically so the same BSSID always lands
 * at the same demo coords — the operator can click "Scatter demo
 * pins" multiple times without the markers jumping around.
 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic demo coords for a given BSSID, jittered around
 * `SCATTER_CENTER`. Output stays inside roughly ±SCATTER_RADIUS_DEGREES.
 */
export function scatterFor(bssid: string): MapPin {
  const h = hashString(bssid);
  const dx = ((h & 0xffff) / 0xffff - 0.5) * 2 * SCATTER_RADIUS_DEGREES;
  const dy = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 2 * SCATTER_RADIUS_DEGREES;
  return { lat: SCATTER_CENTER[1] + dy, lng: SCATTER_CENTER[0] + dx };
}
