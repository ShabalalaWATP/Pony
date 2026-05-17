import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MapPin {
  /** Latitude in WGS-84 decimal degrees. */
  lat: number;
  /** Longitude in WGS-84 decimal degrees. */
  lng: number;
  /** Free-form operator note rendered in the marker popup. */
  note?: string;
}

interface MapPinsState {
  /** Keyed by BSSID (lower-case canonical form). */
  pins: Record<string, MapPin>;
  setPin: (bssid: string, pin: MapPin) => void;
  removePin: (bssid: string) => void;
  clear: () => void;
}

function normaliseBssid(bssid: string): string {
  return bssid.trim().toLowerCase();
}

/**
 * Operator-placed AP locations.
 *
 * Stage 6 has no backend geolocation contract yet — sensors will start
 * to emit lat/lng once a GPS dongle is attached (Stage 6 of the backend
 * plan). Until then, this store lets the operator manually pin APs
 * they recognise on the map, persisting the locations in localStorage
 * per workstation. Once the backend ships a geo endpoint, this store
 * stays useful as the "operator override" layer above the real source.
 */
export const useMapPinsStore = create<MapPinsState>()(
  persist(
    (set) => ({
      pins: {},
      setPin: (bssid, pin) => set((s) => ({ pins: { ...s.pins, [normaliseBssid(bssid)]: pin } })),
      removePin: (bssid) =>
        set((s) => {
          const next = { ...s.pins };
          delete next[normaliseBssid(bssid)];
          return { pins: next };
        }),
      clear: () => set({ pins: {} }),
    }),
    { name: "cp-map-pins", version: 1 },
  ),
);
