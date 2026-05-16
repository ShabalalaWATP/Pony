import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/events")({
  component: () => (
    <StubView
      title="Events"
      stage={4}
      description="Virtualised log of raw events with filter chips and fresh-data halos on insert."
    />
  ),
});
