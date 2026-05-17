import { createFileRoute } from "@tanstack/react-router";
import { DevicesView } from "@/components/devices/DevicesView";

interface DevicesSearch {
  mac?: string;
  q?: string;
}

export const Route = createFileRoute("/_shell/devices/")({
  validateSearch: (search: Record<string, unknown>): DevicesSearch => ({
    mac: typeof search.mac === "string" ? search.mac : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: DevicesView,
});
