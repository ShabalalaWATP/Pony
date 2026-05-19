import { createFileRoute } from "@tanstack/react-router";
import { SensorsView } from "@/components/sensors/SensorsView";

interface SensorsSearch {
  id?: string;
  q?: string;
  /** Deep-link helper: `/sensors?new=1` opens the register drawer. */
  new?: string;
}

export const Route = createFileRoute("/_shell/sensors/")({
  validateSearch: (search: Record<string, unknown>): SensorsSearch => ({
    id: typeof search.id === "string" ? search.id : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    new: typeof search.new === "string" ? search.new : undefined,
  }),
  component: SensorsView,
});
