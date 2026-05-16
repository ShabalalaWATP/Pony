import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/audit")({
  component: () => (
    <StubView
      title="Audit"
      stage={7}
      description="Append-only audit log of every active action: operator, target, parameters, outcome. Filters + CSV export."
    />
  ),
});
