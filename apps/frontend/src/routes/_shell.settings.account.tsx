import { createFileRoute } from "@tanstack/react-router";
import { TotpSetupCard } from "@/components/auth/TotpSetupCard";
import { Badge } from "@/components/ui/Badge";
import { Separator } from "@/components/ui/Separator";
import { useCurrentUser } from "@/services/auth/hooks";

export const Route = createFileRoute("/_shell/settings/account")({
  component: AccountSettings,
});

function AccountSettings(): JSX.Element {
  const { data } = useCurrentUser();
  if (!data) return <></>;

  const { user } = data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg-100">Account</h1>
        <Badge tone="accent" outline>
          Stage 3
        </Badge>
      </header>

      <section className="rounded-md border border-fg-20 bg-bg-1 p-5">
        <div className="mb-3 text-2xs uppercase tracking-wide text-fg-60">Profile</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
          <div className="text-xs text-fg-60">Email</div>
          <div className="font-mono text-sm text-fg-100">{user.email}</div>
          <div className="text-xs text-fg-60">User ID</div>
          <div className="font-mono text-xs text-fg-80">{user.id}</div>
          <div className="text-xs text-fg-60">Roles</div>
          <div className="text-sm text-fg-100">
            {(user.roles ?? []).map((role) => (
              <Badge key={role} tone="neutral" outline className="mr-1.5">
                {role}
              </Badge>
            ))}
            {(!user.roles || user.roles.length === 0) && (
              <span className="text-fg-60">operator</span>
            )}
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mb-3 text-2xs uppercase tracking-wide text-fg-60">Security</div>
        <TotpSetupCard user={user} />
      </section>
    </div>
  );
}
