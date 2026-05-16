import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/captive-portal")({
  component: () => (
    <StubView
      title="Captive Portal"
      stage={7}
      description="Template-driven captive portal with per-engagement audit and tamper-evident asset hashes."
    />
  ),
});
