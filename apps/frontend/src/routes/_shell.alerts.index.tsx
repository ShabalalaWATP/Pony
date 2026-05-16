import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/alerts/")({
  component: () => (
    <StubView
      title="Alerts"
      stage={4}
      description="Alerts inbox with severity chips, acknowledgement flow, and a rule editor."
    />
  ),
});
