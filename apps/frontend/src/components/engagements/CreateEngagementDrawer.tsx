import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import {
  type Engagement,
  type EngagementCreateRequest,
  useCreateEngagement,
} from "@/services/api/labQueries";
import { type ScopeRow, collectScopeRules } from "./createHelpers";

interface CreateEngagementDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful 200 so the parent can navigate or toast. */
  onCreated?: (engagement: Engagement) => void;
}

/**
 * Create-an-engagement drawer. Backed by `POST /api/v1/engagements`.
 *
 * The form is intentionally minimal — the only required field is
 * `name`. Optional scope rules are entered as `field=value` pairs; we
 * collect them as a list of single-key objects to match the backend's
 * `scope_rules: { [key: string]: string }[]` schema. Empty rows are
 * dropped on submit so the operator can leave a stray row blank
 * without polluting the payload.
 *
 * Admin + recent 2FA is enforced server-side. A 403 / 4xx surfaces
 * inline in the drawer; on 200 we close and call back into the parent.
 */
export function CreateEngagementDrawer({
  open,
  onClose,
  onCreated,
}: CreateEngagementDrawerProps): JSX.Element {
  const create = useCreateEngagement();
  const [name, setName] = useState("");
  const [rules, setRules] = useState<ScopeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the drawer closes — operators expect a blank
  // slate next time, and a stale name is the kind of thing that gets
  // an engagement misnamed.
  useEffect(() => {
    if (open) return;
    setName("");
    setRules([]);
    setError(null);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create is stable across renders
  }, [open]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !create.isPending;

  const addRule = (): void => {
    setRules((prev) => [...prev, { rowKey: `${Date.now()}-${prev.length}`, field: "", value: "" }]);
  };
  const removeRule = (rowKey: string): void => {
    setRules((prev) => prev.filter((row) => row.rowKey !== rowKey));
  };
  const updateRule = (rowKey: string, patch: Partial<ScopeRow>): void => {
    setRules((prev) => prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const body: EngagementCreateRequest = {
      name: trimmedName,
      scope_rules: collectScopeRules(rules),
    };
    create.mutate(body, {
      onSuccess: (engagement) => {
        onCreated?.(engagement);
        onClose();
      },
      onError: (err) => {
        setError(
          err.status === 403
            ? "Admin role + recent TOTP is required to create an engagement."
            : err.message,
        );
      },
    });
  };

  return (
    <Drawer open={open} onClose={onClose} title="New engagement" width={520}>
      <form
        className="flex flex-col gap-5"
        onSubmit={handleSubmit}
        data-testid="create-engagement-form"
      >
        <Field label="Name" htmlFor="engagement-name">
          <Input
            id="engagement-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring 2026 assessment — Acme HQ"
            required
            autoFocus
            maxLength={120}
          />
          <span className="text-2xs text-fg-60">
            Operators see the name everywhere — keep it short but identifying.
          </span>
        </Field>

        <section className="flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wide text-fg-60">
              Scope rules (optional)
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={addRule}>
              <Plus className="size-3.5" aria-hidden="true" />
              Add rule
            </Button>
          </header>
          {rules.length === 0 ? (
            <p className="text-2xs text-fg-60">
              No scope rules. The allow-list on the engagement is the real safety net; scope rules
              are free-form metadata that show up in the audit log.
            </p>
          ) : (
            <ul
              className="flex flex-col gap-2 rounded-sm border border-fg-20 bg-bg-inset p-2"
              data-testid="scope-rules"
            >
              {rules.map((row) => (
                <li key={row.rowKey} className="flex items-center gap-2">
                  <Input
                    aria-label="Scope rule field"
                    placeholder="field"
                    value={row.field}
                    onChange={(e) => updateRule(row.rowKey, { field: e.target.value })}
                    maxLength={64}
                    className="w-32"
                  />
                  <span className="text-fg-40">=</span>
                  <Input
                    aria-label="Scope rule value"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateRule(row.rowKey, { value: e.target.value })}
                    maxLength={256}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRule(row.rowKey)}
                    aria-label="Remove scope rule"
                  >
                    <Trash2 className="size-3.5 text-accent-red" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && (
          <p
            role="alert"
            data-testid="create-engagement-error"
            className="text-2xs text-accent-red"
          >
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-fg-20 pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {create.isPending ? "Creating…" : "Create engagement"}
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-2xs uppercase tracking-wide text-fg-60">{label}</span>
      {children}
    </label>
  );
}
