import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/deauth")({
  component: () => (
    <StubView
      title="Deauth"
      stage={7}
      description="aireplay-ng-driven deauth with type-to-confirm modal. Targets must be on the active engagement's allow-list."
    />
  ),
});
