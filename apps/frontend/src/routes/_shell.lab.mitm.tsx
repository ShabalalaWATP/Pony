import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/mitm")({
  component: () => (
    <StubView
      title="MITM"
      stage={7}
      description="Bettercap-driven MITM panel with per-flow audit, kill-switch, and engagement-scoped logging."
    />
  ),
});
