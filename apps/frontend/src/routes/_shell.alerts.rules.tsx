import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/alerts/rules")({
  component: () => (
    <StubView
      title="Alert rules"
      stage={4}
      description="Define rules over the event stream — new SSID, signal threshold breach, probe-graph anomaly."
    />
  ),
});
