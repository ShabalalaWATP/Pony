import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/settings/about")({
  component: () => (
    <StubView
      title="About"
      stage={8}
      description="Build hash, version, SBOM links, licence inventory, supported-versions table."
    />
  ),
});
