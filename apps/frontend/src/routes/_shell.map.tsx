import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/map")({
  component: () => (
    <StubView
      title="Map"
      stage={6}
      description="MapLibre AP map with GPS-derived locations (when a GPS dongle is attached) or manual fixes."
    />
  ),
});
