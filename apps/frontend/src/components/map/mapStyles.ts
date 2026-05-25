/**
 * MapLibre base-layer catalogue.
 *
 * Each entry is a self-contained `StyleSpecification` (or a URL pointing
 * at one) plus a stable identifier and human label. `MapCanvas` consumes
 * the `style` field directly; the rest of the app references entries
 * by `id` so swapping in a new style is a one-line append here.
 *
 * Design rules:
 * - **No third-party tile egress.** Built-in styles are local JSON only
 *   with no remote sources. Deployments that need rich basemaps should
 *   serve self-hosted tiles/styles and add them through a reviewed
 *   configuration path, not a hard-coded public provider.
 * - **Open/closed.** Adding a 4th style means appending to
 *   `MAP_STYLES`. No other file in the app needs to change.
 *
 */

import type { StyleSpecification } from "maplibre-gl";

export type MapStyleId = "street" | "satellite" | "hybrid";

export interface MapStyleDef {
  /** Stable id persisted in `useMapStyleStore`. */
  id: MapStyleId;
  /** Short label rendered in the segmented switcher (≤10 chars). */
  label: string;
  /** Longer description for tooltips / aria-describedby. */
  description: string;
  /** MapLibre style — URL or full spec object. */
  style: string | StyleSpecification;
}

const localStreetStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "street-background",
      type: "background",
      paint: { "background-color": "#0f172a" },
    },
  ],
};

const satelliteStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "satellite-background",
      type: "background",
      paint: { "background-color": "#111827" },
    },
  ],
};

const hybridStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "hybrid-background",
      type: "background",
      paint: { "background-color": "#0b1220" },
    },
  ],
};

/**
 * Tuple typing here (not `MapStyleDef[]`) lets `MAP_STYLES[0]` resolve
 * to `MapStyleDef` rather than `MapStyleDef | undefined` — keeps
 * `styleDefFor`'s fallback statically safe under `noUncheckedIndexedAccess`.
 */
export const MAP_STYLES: readonly [MapStyleDef, MapStyleDef, MapStyleDef] = [
  {
    id: "street",
    label: "Street",
    description: "MapLibre vector basemap — dark, low-detail, no labels obscuring markers.",
    style: localStreetStyle,
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "Local placeholder basemap — no external tile requests.",
    style: satelliteStyle,
  },
  {
    id: "hybrid",
    label: "Hybrid",
    description: "Local placeholder basemap — no external tile requests.",
    style: hybridStyle,
  },
] as const;

/**
 * Resolve a style id to its descriptor, falling back to the first
 * entry (Street) if the id has gone stale in localStorage after a
 * version bump that dropped an option.
 */
export function styleDefFor(id: MapStyleId): MapStyleDef {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}
