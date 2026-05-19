import { createFileRoute } from "@tanstack/react-router";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AppShell } from "@/components/layout/AppShell";

function GuardedShell(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell />
    </AuthGuard>
  );
}

export const Route = createFileRoute("/_shell")({
  component: GuardedShell,
});
