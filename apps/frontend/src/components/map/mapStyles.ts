/**
 * MapLibre base-layer catalogue.
 *
 * Each entry is a self-contained `StyleSpecification` (or a URL pointing
 * at one) plus a stable identifier and human label. `MapCanvas` consumes
 * the `style` field directly; the rest of the app references entries
 * by `id` so swapping in a new style is a one-line append here.
 *
 * Design rules:
 * - **No API keys in the client.** Esri's public ArcGIS REST endpoints
 *   are key-less for non-commercial use; MapLibre demotiles is public.
 *   Anything that needs a token belongs behind the backend.
 * - **HTTPS only.** Each tile source uses `https://…` so the page
 *   stays mixed-content-clean.
 * - **Attribution baked in.** Esri's ToS requires "Source: Esri,
 *   Maxar, Earthstar Geographics" on imagery; MapLibre's style already
 *   carries its own. We pass `attribution` per source so MapLibre's
 *   default attribution control surfaces both.
 * - **Open/closed.** Adding a 4th style means appending to
 *   `MAP_STYLES`. No other file in the app needs to change.
 *
 * Note on CSP: the backend's content-security-policy currently uses
 * `default-src 'self'` and so will block tile fetches in production.
 * The accompanying backend brief lists the domains that need to be
 * added to `connect-src` / `img-src` (`demotiles.maplibre.org` and
 * `server.arcgisonline.com`). In dev, Vite serves the SPA without a
 * CSP so the switcher is fully exercisable.
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

const ESRI_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REFERENCE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION_IMAGERY =
  "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS community";
const ESRI_ATTRIBUTION_REFERENCE = "Labels © Esri";

const satelliteStyle: StyleSpecification = {
  version: 8,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [ESRI_IMAGERY_TILES],
      tileSize: 256,
      attribution: ESRI_ATTRIBUTION_IMAGERY,
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri-imagery", type: "raster", source: "esri-imagery" }],
};

const hybridStyle: StyleSpecification = {
  version: 8,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [ESRI_IMAGERY_TILES],
      tileSize: 256,
      attribution: ESRI_ATTRIBUTION_IMAGERY,
      maxzoom: 19,
    },
    "esri-labels": {
      type: "raster",
      tiles: [ESRI_REFERENCE_TILES],
      tileSize: 256,
      attribution: ESRI_ATTRIBUTION_REFERENCE,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "esri-imagery", type: "raster", source: "esri-imagery" },
    { id: "esri-labels", type: "raster", source: "esri-labels" },
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
    style: "https://demotiles.maplibre.org/style.json",
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "Esri World Imagery raster basemap — overhead photography, no labels.",
    style: satelliteStyle,
  },
  {
    id: "hybrid",
    label: "Hybrid",
    description: "Esri World Imagery + transparent Esri Reference labels.",
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
