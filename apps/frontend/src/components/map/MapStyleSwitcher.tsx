import { Layers } from "lucide-react";
import { MAP_STYLES } from "./mapStyles";
import { useMapStyleStore } from "@/stores/useMapStyleStore";
import { cn } from "@/lib/cn";

/**
 * Compact segmented control that lets the operator switch the map
 * base layer between Street / Satellite / Hybrid.
 *
 * Knows nothing about MapLibre or tile URLs — that's `mapStyles.ts`
 * and `MapCanvas`. This component is pure UI bound to
 * `useMapStyleStore`. Adding a new option means appending to
 * `MAP_STYLES`; this component automatically renders the new button.
 */
export function MapStyleSwitcher(): JSX.Element {
  const styleId = useMapStyleStore((s) => s.styleId);
  const setStyleId = useMapStyleStore((s) => s.setStyleId);

  return (
    <div
      role="group"
      aria-label="Map base layer"
      data-testid="map-style-switcher"
      className="inline-flex items-center gap-0 rounded-sm border border-fg-20 bg-bg-2 p-0.5"
    >
      <span className="px-1.5 text-fg-60" aria-hidden="true">
        <Layers className="size-3.5" />
      </span>
      {MAP_STYLES.map((s) => {
        const active = styleId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setStyleId(s.id)}
            aria-pressed={active}
            title={s.description}
            data-testid={`map-style-${s.id}`}
            className={cn(
              "rounded-sm px-2 py-1 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mode",
              active
                ? "bg-mode/15 font-medium text-mode"
                : "text-fg-60 hover:bg-bg-3 hover:text-fg-100",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
