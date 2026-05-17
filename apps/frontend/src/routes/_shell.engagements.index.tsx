import { createFileRoute } from "@tanstack/react-router";
import { EngagementsView } from "@/components/engagements/EngagementsView";

interface EngagementsSearch {
  /** Deep-link helper: `/engagements?new=1` opens the create drawer. */
  new?: string;
}

export const Route = createFileRoute("/_shell/engagements/")({
  validateSearch: (search: Record<string, unknown>): EngagementsSearch => ({
    new: typeof search.new === "string" ? search.new : undefined,
  }),
  component: EngagementsView,
});
