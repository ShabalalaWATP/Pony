import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/evil-twin")({
  component: () => (
    <StubView
      title="Evil Twin"
      stage={7}
      description="Spawn an SSID twin with mirrored beacon parameters; live client-association feed; auto-disable on engagement close."
    />
  ),
});
