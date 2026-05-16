import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/settings/users")({
  component: () => (
    <StubView
      title="Users"
      stage={3}
      description="Admin-only user management — invite, role assignment, 2FA enforcement, revocation."
    />
  ),
});
