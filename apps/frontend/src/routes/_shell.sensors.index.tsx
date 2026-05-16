import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/sensors/")({
  component: () => (
    <StubView
      title="Sensors"
      stage={5}
      description="Virtualised sensor list with status, capabilities, event rate sparklines, and a per-sensor detail drawer."
    />
  ),
});
