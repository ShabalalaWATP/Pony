import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertRuleForm } from "./AlertRuleForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type AlertRule,
  type AlertRuleCreateRequest,
  type AlertRuleUpdateRequest,
  useAlertRulesList,
  useCreateAlertRule,
  useDeleteAlertRule,
  useUpdateAlertRule,
} from "@/services/api/queries";

interface DrawerState {
  mode: "create" | "edit";
  rule?: AlertRule;
}

function columns(
  onEdit: (rule: AlertRule) => void,
  onDelete: (rule: AlertRule) => void,
  busyDeleteId: string | undefined,
): ColumnDef<AlertRule, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: (ctx) => <span className="truncate text-fg-100">{ctx.getValue<string>()}</span>,
    },
    {
      accessorKey: "severity",
      header: "Severity",
      cell: (ctx) => <AlertSeverityChip severity={ctx.row.original.severity} />,
      size: 130,
    },
    {
      accessorKey: "enabled",
      header: "Enabled",
      cell: (ctx) =>
        ctx.row.original.enabled ? (
          <Badge tone="green" outline>
            on
          </Badge>
        ) : (
          <Badge tone="neutral" outline>
            off
          </Badge>
        ),
      size: 100,
    },
    {
      accessorKey: "created_by",
      header: "Created by",
      cell: (ctx) => <span className="font-mono text-xs text-fg-80">{ctx.getValue<string>()}</span>,
      size: 200,
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: (ctx) => {
        const v = ctx.getValue<string | undefined>();
        return v ? <RelativeTime value={v} /> : <span className="text-fg-40">—</span>;
      },
      size: 110,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: (ctx) => {
        const rule = ctx.row.original;
        const deleting = busyDeleteId === rule.id;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(rule);
              }}
              aria-label={`Edit ${rule.name}`}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(rule);
              }}
              aria-label={`Delete ${rule.name}`}
            >
              <Trash2 className="size-3.5 text-accent-red" aria-hidden="true" />
            </Button>
          </div>
        );
      },
      size: 110,
    },
  ];
}

/**
 * Alert rules admin view.
 *
 * Reads `/api/v1/alerts/rules`. CRUD mutations require admin + recent
 * 2FA + CSRF — the backend enforces this and returns 403 on a missing
 * gate. The page renders an explanatory empty state when the list
 * query itself 403s so non-admin operators land on a useful surface
 * rather than a stack trace.
 *
 * Deletes prompt via `window.confirm` (per design spec for any
 * destructive action) so a stray keystroke can't wipe a rule. A
 * heavier "type-to-confirm" affordance kicks in on Stage 7 with the
 * lab-mode active modules; for rule management the confirm-on-delete
 * is enough.
 */
export function AlertRulesView(): JSX.Element {
  const navigate = useNavigate();
  const search: { id?: string; new?: string } = useSearch({ strict: false });
  const query = useAlertRulesList({ limit: 500 });
  const create = useCreateAlertRule();
  const update = useUpdateAlertRule();
  const remove = useDeleteAlertRule();
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const drawer = useMemo<DrawerState | null>(() => {
    if (search.new === "1") return { mode: "create" };
    if (search.id) {
      const rule = items.find((r) => r.id === search.id);
      if (rule) return { mode: "edit", rule };
    }
    return null;
  }, [items, search.id, search.new]);

  const closeDrawer = (): void => {
    setError(null);
    void navigate({ to: "/alerts/rules", search: {} });
  };

  const handleCreate = (payload: AlertRuleCreateRequest | AlertRuleUpdateRequest): void => {
    setError(null);
    create.mutate(payload as AlertRuleCreateRequest, {
      onError: (err) => setError(err.message),
      onSuccess: () => closeDrawer(),
    });
  };

  const handleUpdate =
    (rule: AlertRule) =>
    (payload: AlertRuleCreateRequest | AlertRuleUpdateRequest): void => {
      setError(null);
      update.mutate(
        { id: rule.id, patch: payload },
        {
          onError: (err) => setError(err.message),
          onSuccess: () => closeDrawer(),
        },
      );
    };

  const handleDelete = (rule: AlertRule): void => {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    setError(null);
    remove.mutate(rule.id, { onError: (err) => setError(err.message) });
  };

  const cols = useMemo(
    () =>
      columns(
        (rule) => void navigate({ to: "/alerts/rules", search: { id: rule.id } }),
        handleDelete,
        remove.isPending ? remove.variables : undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutations are stable refs.
    [remove.isPending, remove.variables, navigate],
  );

  if (query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Alert rules" />
        <EmptyState
          title="Admin + 2FA required"
          description="Rule management is gated to admins with a recent TOTP verification. Switch users or re-verify to continue."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Alert rules" total={query.data?.total}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void navigate({ to: "/alerts/rules", search: { new: "1" } })}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New rule
        </Button>
      </PageHeader>

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"
        >
          {error}
        </div>
      )}

      <DataTable<AlertRule>
        data={items}
        columns={cols}
        onRowOpen={(rule) => void navigate({ to: "/alerts/rules", search: { id: rule.id } })}
        getRowId={(row) => row.id}
        label="Alert rules"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No alert rules yet"
            description="Define a rule to start firing alerts. Try matching new SSIDs or specific BSSIDs."
          />
        }
      />

      <Drawer
        open={drawer !== null}
        onClose={closeDrawer}
        title={drawer?.mode === "create" ? "New alert rule" : `Edit: ${drawer?.rule?.name ?? ""}`}
      >
        {drawer?.mode === "create" && (
          <AlertRuleForm
            submitLabel="Create"
            busy={create.isPending}
            onCancel={closeDrawer}
            onSubmit={handleCreate}
          />
        )}
        {drawer?.mode === "edit" && drawer.rule && (
          <AlertRuleForm
            key={drawer.rule.id}
            initial={drawer.rule}
            submitLabel="Save changes"
            busy={update.isPending}
            onCancel={closeDrawer}
            onSubmit={handleUpdate(drawer.rule)}
          />
        )}
      </Drawer>
    </div>
  );
}
