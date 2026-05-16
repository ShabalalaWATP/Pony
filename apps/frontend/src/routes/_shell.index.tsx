import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/")({
  component: () => (
    <StubView
      title="Overview"
      stage={4}
      description="KPI tiles, live event stream, top APs by signal, signal histogram, and recent alerts — wired to the operator WebSocket."
    />
  ),
});
