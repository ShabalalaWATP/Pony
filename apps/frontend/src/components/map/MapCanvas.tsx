import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { type MapPin } from "@/stores/useMapPinsStore";

interface MapCanvasProps {
  pins: Record<string, MapPin>;
  /**
   * Optional pending pin label — when the operator has selected an AP
   * in the sidebar but not yet clicked the map. Used so the cursor
   * crosshair-state is visible.
   */
  pending?: { bssid: string; label: string } | null;
  /**
   * Imperative camera move. When the *identity* of this object changes
   * (i.e. a new object is passed, not the same reference), the map
   * animates to the new center and zoom. Used by the "Scatter demo
   * pins" affordance so the operator can see the scattered pins
   * immediately instead of being left at world-zoom.
   */
  flyTo?: { center: [number, number]; zoom: number } | null;
  onMapClick: (lngLat: { lng: number; lat: number }) => void;
  onPinClick: (bssid: string) => void;
}

const STYLE_URL =
  // OSM raster tiles via the demo MapLibre style. No API key needed; for
  // production Stage 8 we'd swap in a self-hosted PMTiles bundle.
  "https://demotiles.maplibre.org/style.json";

/**
 * Thin React wrapper around a MapLibre GL instance.
 *
 * The map is created exactly once and held in a ref; pins are added /
 * removed by diffing the supplied `pins` object against the marker set
 * we already rendered. Clicking the map fires `onMapClick`. Clicking a
 * marker fires `onPinClick`. The actual storage layer (Zustand) lives
 * upstream so this component is purely a renderer.
 */
export function MapCanvas({
  pins,
  pending,
  flyTo,
  onMapClick,
  onPinClick,
}: MapCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  // Stash the callbacks in refs so the (expensive) map effect doesn't
  // re-create the map on every re-render.
  const callbacksRef = useRef({ onMapClick, onPinClick });
  callbacksRef.current = { onMapClick, onPinClick };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [0, 30],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("click", (e) => {
      callbacksRef.current.onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  // Sync markers with pins prop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove markers no longer in the pin set.
    for (const [bssid, marker] of markersRef.current) {
      if (!(bssid in pins)) {
        marker.remove();
        markersRef.current.delete(bssid);
      }
    }
    // Add / move markers for the current pins.
    for (const [bssid, pin] of Object.entries(pins)) {
      const existing = markersRef.current.get(bssid);
      if (existing) {
        existing.setLngLat([pin.lng, pin.lat]);
        continue;
      }
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `AP ${bssid}`);
      el.style.cssText =
        "width:14px;height:14px;border-radius:9999px;border:2px solid hsl(var(--mode-accent));background:hsl(var(--bg-2));cursor:pointer;";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onPinClick(bssid);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      markersRef.current.set(bssid, marker);
    }
  }, [pins]);

  // Visual hint when the operator is mid-placement.
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = pending ? "crosshair" : "";
  }, [pending]);

  // Imperative camera move. Re-runs when `flyTo` *identity* changes —
  // pass a fresh object to retrigger.
  useEffect(() => {
    if (!flyTo) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, duration: 1200 });
  }, [flyTo]);

  return (
    <div
      ref={containerRef}
      data-testid="map-canvas"
      aria-label={pending ? `Placing pin for ${pending.label}` : "Access-point map"}
      className="h-full w-full"
    />
  );
}
