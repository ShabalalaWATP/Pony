import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { useCurrentUser } from "@/services/auth/hooks";
import {
  type UserPublic,
  type UserUpdateRequest,
  useUpdateUser,
  useUsersList,
} from "@/services/api/userQueries";

const ROLE_OPTIONS = ["operator", "admin"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

const columns: ColumnDef<UserPublic, unknown>[] = [
  {
    accessorKey: "email",
    header: "Email",
    cell: (ctx) => <span className="truncate text-fg-100">{ctx.getValue<string>()}</span>,
  },
  {
    id: "roles",
    header: "Roles",
    cell: (ctx) => {
      const roles = ctx.row.original.roles ?? [];
      if (roles.length === 0) return <span className="text-fg-40">none</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {roles.map((r) => (
            <Badge key={r} tone={r === "admin" ? "violet" : "neutral"} outline>
              {r}
            </Badge>
          ))}
        </div>
      );
    },
    size: 200,
  },
  {
    accessorKey: "totp_enabled",
    header: "2FA",
    cell: (ctx) =>
      ctx.getValue<boolean>() ? (
        <Badge tone="green" outline>
          <ShieldCheck className="size-3" aria-hidden="true" />
          on
        </Badge>
      ) : (
        <Badge tone="amber" outline>
          <ShieldX className="size-3" aria-hidden="true" />
          off
        </Badge>
      ),
    size: 100,
  },
  {
    accessorKey: "id",
    header: "ID",
    cell: (ctx) => <span className="font-mono text-2xs text-fg-60">{ctx.getValue<string>()}</span>,
    size: 260,
  },
];

/**
 * `/settings/users` — admin-only user management.
 *
 * Lists every user via `GET /api/v1/users` and lets an admin edit one
 * via a drawer-driven `PATCH /api/v1/users/{id}` (roles, reset TOTP).
 * The backend enforces:
 * - admin + recent 2FA + CSRF on every state-changing call,
 * - a roles whitelist (`operator | admin`, anything else → 422),
 * - a "last admin" guard (409 if the caller demotes themselves and
 *   no other admin exists).
 * Each successful update writes an audit log entry server-side.
 *
 * A non-admin gets a 403 on the list and sees the explanatory empty
 * state. The current user's row gets a "you" hint so an admin
 * about to demote themselves notices.
 */
export function UsersView(): JSX.Element {
  const query = useUsersList({ limit: 500 });
  const me = useCurrentUser();
  const [editing, setEditing] = useState<UserPublic | null>(null);

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  if (query.error?.status === 401 || query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4" data-testid="settings-users">
        <PageHeader title="Users" />
        <EmptyState
          title="Admin + 2FA required"
          description="User management is gated. Sign in as an admin and complete TOTP verification to view this list."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="settings-users">
      <PageHeader title="Users" total={query.data?.total} />

      <DataTable<UserPublic>
        data={items}
        columns={columns}
        getRowId={(row) => row.id}
        onRowOpen={(user) => setEditing(user)}
        label="Users"
        maxHeight={520}
        emptyState={<EmptyState title="No users on file." />}
      />

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? <span className="truncate font-mono">{editing.email}</span> : "Edit user"}
        width={520}
      >
        {editing && (
          <EditUserForm
            user={editing}
            isSelf={me.data?.user.id === editing.id}
            onDone={() => setEditing(null)}
          />
        )}
      </Drawer>
    </div>
  );
}

interface EditUserFormProps {
  user: UserPublic;
  isSelf: boolean;
  onDone: () => void;
}

function EditUserForm({ user, isSelf, onDone }: EditUserFormProps): JSX.Element {
  const update = useUpdateUser();
  const [roles, setRoles] = useState<Set<RoleOption>>(() => initialRoles(user));
  const [resetTotp, setResetTotp] = useState(false);

  useEffect(() => {
    setRoles(initialRoles(user));
    setResetTotp(false);
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- update is stable
  }, [user]);

  const originalRoles = initialRoles(user);
  const rolesChanged = !sameSet(roles, originalRoles);
  const canSubmit = (rolesChanged || resetTotp) && !update.isPending && !update.isSuccess;
  const removingOwnAdmin = isSelf && originalRoles.has("admin") && !roles.has("admin");

  const toggleRole = (role: RoleOption): void => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    const patch: UserUpdateRequest = {
      reset_totp: resetTotp,
      roles: rolesChanged ? Array.from(roles).sort() : null,
    };
    update.mutate({ id: user.id, patch });
  };

  const errorMessage = update.error
    ? update.error.status === 403
      ? "Admin role + recent TOTP is required to update users."
      : update.error.status === 409
        ? "Refused: this user is the last admin on file."
        : update.error.message
    : null;

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} data-testid="edit-user-form">
      <DetailSection label="Identity">
        <DetailRow label="Email" value={<span className="font-mono">{user.email}</span>} />
        <DetailRow
          label="ID"
          value={<span className="font-mono text-xs text-fg-80">{user.id}</span>}
        />
        <DetailRow
          label="2FA on file"
          value={
            user.totp_enabled ? (
              <Badge tone="green" outline>
                enabled
              </Badge>
            ) : (
              <Badge tone="amber" outline>
                disabled
              </Badge>
            )
          }
        />
        {isSelf && (
          <DetailRow
            label="You"
            value={<span className="text-2xs text-fg-60">This is your own account.</span>}
          />
        )}
      </DetailSection>

      <section className="flex flex-col gap-2">
        <header className="text-2xs uppercase tracking-wide text-fg-60">Roles</header>
        <ul className="grid grid-cols-2 gap-1.5 rounded-sm border border-fg-20 bg-bg-inset p-2">
          {ROLE_OPTIONS.map((role) => {
            const checked = roles.has(role);
            return (
              <li key={role}>
                <label className="flex items-center gap-2 text-xs text-fg-100">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole(role)}
                    aria-label={role}
                    className="size-3.5 accent-mode"
                  />
                  <span className="font-mono">{role}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {removingOwnAdmin && (
          <p
            role="alert"
            data-testid="self-demote-warning"
            className="flex items-center gap-2 rounded-sm border border-accent-amber/40 bg-accent-amber/10 px-2 py-1 text-2xs text-accent-amber"
          >
            <ShieldX className="size-3" aria-hidden="true" />
            You&apos;re removing your own admin role. The backend will refuse if you&apos;re the
            last admin.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <header className="text-2xs uppercase tracking-wide text-fg-60">TOTP</header>
        <label className="flex items-center gap-2 rounded-sm border border-fg-20 bg-bg-inset p-2 text-xs text-fg-100">
          <input
            type="checkbox"
            checked={resetTotp}
            onChange={(e) => setResetTotp(e.target.checked)}
            aria-label="Reset TOTP"
            className="size-3.5 accent-mode"
          />
          <span>
            Reset 2FA — clears the user&apos;s TOTP secret and forces them to re-enroll on next
            sign-in.
          </span>
        </label>
      </section>

      {errorMessage && (
        <p role="alert" data-testid="edit-user-error" className="text-2xs text-accent-red">
          {errorMessage}
        </p>
      )}

      {update.isSuccess && (
        <p
          role="status"
          data-testid="edit-user-success"
          className="rounded-sm border border-accent-green/40 bg-accent-green/10 px-2 py-1 text-2xs text-accent-green"
        >
          Saved. Audit entry written.
        </p>
      )}

      <footer className="flex items-center justify-end gap-2 border-t border-fg-20 pt-3">
        <Button type="button" variant="ghost" onClick={onDone} disabled={update.isPending}>
          Close
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </footer>
    </form>
  );
}

function initialRoles(user: UserPublic): Set<RoleOption> {
  const known = (user.roles ?? []).filter((r): r is RoleOption =>
    (ROLE_OPTIONS as readonly string[]).includes(r),
  );
  return new Set(known);
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
