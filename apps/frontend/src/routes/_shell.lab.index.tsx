import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/")({
  component: () => (
    <StubView
      title="Lab"
      stage={7}
      description="Active-module hub. Only reachable when LAB_MODE is enabled, the Authorized-Operator acknowledgement is on file, and a scoped engagement is active."
    />
  ),
});
