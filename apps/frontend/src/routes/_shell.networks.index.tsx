import { createFileRoute } from "@tanstack/react-router";
import { NetworksView } from "@/components/networks/NetworksView";

interface NetworksSearch {
  bssid?: string;
  q?: string;
}

export const Route = createFileRoute("/_shell/networks/")({
  validateSearch: (search: Record<string, unknown>): NetworksSearch => ({
    bssid: typeof search.bssid === "string" ? search.bssid : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: NetworksView,
});
