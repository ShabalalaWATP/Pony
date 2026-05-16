import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/settings/account")({
  component: () => (
    <StubView
      title="Account"
      stage={3}
      description="Profile, password rotation, TOTP setup + recovery codes, active session list."
    />
  ),
});
