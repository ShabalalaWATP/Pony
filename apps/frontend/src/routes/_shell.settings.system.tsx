import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/settings/system")({
  component: () => (
    <StubView
      title="System"
      stage={7}
      description="Authorized-Operator acknowledgement, retention policies, system-level toggles."
    />
  ),
});
