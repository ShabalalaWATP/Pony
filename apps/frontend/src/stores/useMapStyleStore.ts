import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAP_STYLES, type MapStyleId } from "@/components/map/mapStyles";

interface MapStyleState {
  /** Currently selected base layer. */
  styleId: MapStyleId;
  /** Switch base layer. Unknown ids are ignored. */
  setStyleId: (id: MapStyleId) => void;
}

/**
 * Operator's chosen map base layer, persisted per workstation.
 *
 * The store deliberately owns nothing more than the id — the tile
 * URLs, attribution and MapLibre style spec live in
 * `components/map/mapStyles.ts`. Keeping the boundary narrow means
 * a future change to the catalogue (adding "Topo", swapping a
 * provider, etc.) never touches persisted state shapes.
 */
export const useMapStyleStore = create<MapStyleState>()(
  persist(
    (set) => ({
      styleId: "street",
      setStyleId: (id) => {
        // Guard against stale ids that survived a version bump where
        // an option was removed. The component layer always renders
        // *something*, but persisting a phantom id here would mean
        // every subsequent setStyleId(other) still produces "phantom"
        // until cleared.
        if (!MAP_STYLES.some((s) => s.id === id)) return;
        set({ styleId: id });
      },
    }),
    { name: "cp-map-style", version: 1 },
  ),
);
