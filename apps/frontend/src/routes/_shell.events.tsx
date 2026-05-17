import { createFileRoute } from "@tanstack/react-router";
import { EventsView } from "@/components/events/EventsView";

interface EventsSearch {
  id?: string;
  q?: string;
  /** Comma-separated EventKind values; absent = all kinds. */
  kinds?: string;
}

export const Route = createFileRoute("/_shell/events")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    id: typeof search.id === "string" ? search.id : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    kinds: typeof search.kinds === "string" ? search.kinds : undefined,
  }),
  component: EventsView,
});
