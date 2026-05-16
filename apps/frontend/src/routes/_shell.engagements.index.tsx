import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/engagements/")({
  component: () => (
    <StubView
      title="Engagements"
      stage={7}
      description="Create + manage engagements that scope active modules. Each engagement carries its own target allow-list and audit log."
    />
  ),
});
