import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { Drawer } from "@/components/ui/Drawer";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { useAuditList, type AuditLog } from "@/services/api/queries";
import {
  collectActionPrefixes,
  filterAudit,
  outcomeTone,
  type AuditOutcomeFilter,
} from "./filters";

interface AuditSearch {
  /** Currently-selected entry id, deep-linked. */
  id?: string;
  /** Substring filter applied across actor/action/outcome/target. */
  q?: string;
  /** Single-action filter chip (e.g. `lab.deauth.start`). */
  action?: string;
  /** `denied` shorthand chip — restricts to denied outcomes. */
  outcome?: AuditOutcomeFilter;
}

/**
 * Append-only audit log viewer.
 *
 * The backend exposes a paginated read — no server-side filtering —
 * so this view does the filtering client-side against the most
 * recent page (default 200 entries). For larger windows the operator
 * can paginate with the URL `offset` once we wire it; for now the
 * table is the right surface to scan the recent activity.
 *
 * Every row opens a deep-linkable drawer with the full `parameters`
 * + `target` JSON and the action timeline (started_at → finished_at).
 * The JSON is rendered inside a `<pre>` — never `dangerouslySetInner
 * HTML` — so a hostile audit body can't smuggle markup into the page.
 */
export function AuditView(): JSX.Element {
  const navigate = useNavigate();
  const search: AuditSearch = useSearch({ strict: false });
  const query = useAuditList({ limit: 200 });
  const [searchTerm, setSearchTerm] = useState(search.q ?? "");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const filtered = useMemo(
    () => filterAudit(items, search.action, search.outcome),
    [items, search.action, search.outcome],
  );
  const selected = useMemo(
    () => (search.id ? items.find((row) => row.id === search.id) : undefined),
    [search.id, items],
  );

  const open = (entry: AuditLog): void => {
    void navigate({
      to: "/audit",
      search: { ...search, id: entry.id },
    });
  };
  const close = (): void => {
    void navigate({ to: "/audit", search: { ...search, id: undefined } });
  };
  const setAction = (action: string | undefined): void => {
    void navigate({
      to: "/audit",
      search: { ...search, action },
    });
  };
  const setOutcome = (outcome: AuditSearch["outcome"]): void => {
    void navigate({
      to: "/audit",
      search: { ...search, outcome },
    });
  };

  // Compute the distinct action prefixes for the filter strip so the
  // chips reflect what's actually on this page rather than a hard-
  // coded list that would drift from the backend.
  const actionPrefixes = useMemo(() => collectActionPrefixes(items), [items]);

  if (query.error?.status === 401 || query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Audit" />
        <EmptyState
          title="Audit log is restricted"
          description="Audit log access is gated to admins with recent TOTP verification."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit"
        total={query.data?.total}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Filter by actor, action, outcome, target…",
        }}
      />

      <FilterChips
        prefixes={actionPrefixes}
        activeAction={search.action}
        activeOutcome={search.outcome}
        onAction={setAction}
        onOutcome={setOutcome}
      />

      <DataTable<AuditLog>
        data={filtered}
        columns={columns}
        globalFilter={searchTerm}
        onRowOpen={open}
        getRowId={(row) => row.id}
        label="Audit entries"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No audit entries match"
            description="Try clearing the action / outcome chips or the search box."
          />
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        title={
          <div className="flex items-center gap-3 truncate">
            <Badge tone={outcomeTone(selected?.outcome ?? "")} outline>
              {selected?.outcome ?? ""}
            </Badge>
            <span className="truncate font-mono text-xs text-fg-80">{selected?.action ?? ""}</span>
          </div>
        }
        width={560}
      >
        {selected ? (
          <AuditEntryDetail entry={selected} />
        ) : (
          <EmptyState title="Audit entry not in current page" />
        )}
      </Drawer>
    </div>
  );
}

const columns: ColumnDef<AuditLog, unknown>[] = [
  {
    accessorKey: "occurred_at",
    header: "When",
    cell: (ctx) => {
      const v = ctx.getValue<string | undefined>();
      return v ? <RelativeTime value={v} /> : <span className="text-fg-40">—</span>;
    },
    size: 140,
  },
  {
    accessorKey: "actor_id",
    header: "Actor",
    cell: (ctx) => <span className="font-mono text-xs text-fg-80">{ctx.getValue<string>()}</span>,
    size: 200,
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: (ctx) => (
      <span className="truncate font-mono text-xs text-fg-100">{ctx.getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "outcome",
    header: "Outcome",
    cell: (ctx) => {
      const value = ctx.getValue<string>();
      return (
        <Badge tone={outcomeTone(value)} outline>
          {value}
        </Badge>
      );
    },
    size: 200,
  },
];

interface FilterChipsProps {
  prefixes: string[];
  activeAction: string | undefined;
  activeOutcome: AuditSearch["outcome"];
  onAction: (action: string | undefined) => void;
  onOutcome: (outcome: AuditSearch["outcome"]) => void;
}

/**
 * Filter strip rendered above the audit table. Two slices:
 *   - action prefixes (computed from the loaded page, so the chip
 *     surface reflects real traffic)
 *   - outcome (denied / ok shortcut chips)
 */
function FilterChips({
  prefixes,
  activeAction,
  activeOutcome,
  onAction,
  onOutcome,
}: FilterChipsProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="audit-filters">
      <span className="text-2xs uppercase tracking-wide text-fg-60">Outcome:</span>
      <ChipButton
        active={activeOutcome === "denied"}
        onClick={() => onOutcome(activeOutcome === "denied" ? undefined : "denied")}
      >
        denied
      </ChipButton>
      <ChipButton
        active={activeOutcome === "ok"}
        onClick={() => onOutcome(activeOutcome === "ok" ? undefined : "ok")}
      >
        ok
      </ChipButton>
      {prefixes.length > 0 && (
        <span className="ml-2 text-2xs uppercase tracking-wide text-fg-60">Action:</span>
      )}
      {prefixes.map((prefix) => (
        <ChipButton
          key={prefix}
          active={activeAction === prefix}
          onClick={() => onAction(activeAction === prefix ? undefined : prefix)}
        >
          {prefix}
        </ChipButton>
      ))}
      {(activeAction !== undefined || activeOutcome !== undefined) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onAction(undefined);
            onOutcome(undefined);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-sm border border-mode/40 bg-mode/15 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-mode"
          : "rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-fg-60 hover:text-fg-100"
      }
    >
      {children}
    </button>
  );
}

function AuditEntryDetail({ entry }: { entry: AuditLog }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="ID"
          value={<span className="font-mono text-xs text-fg-80">{entry.id}</span>}
        />
        <DetailRow
          label="Actor"
          value={<span className="font-mono text-xs text-fg-80">{entry.actor_id}</span>}
        />
        <DetailRow
          label="Action"
          value={<span className="font-mono text-xs text-fg-100">{entry.action}</span>}
        />
        <DetailRow
          label="Outcome"
          value={
            <Badge tone={outcomeTone(entry.outcome)} outline>
              {entry.outcome}
            </Badge>
          }
        />
      </DetailSection>

      <DetailSection label="Timing">
        <DetailRow
          label="Occurred"
          value={
            entry.occurred_at ? (
              <RelativeTime value={entry.occurred_at} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <DetailRow
          label="Started"
          value={
            entry.started_at ? (
              <RelativeTime value={entry.started_at} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
        <DetailRow
          label="Finished"
          value={
            entry.finished_at ? (
              <RelativeTime value={entry.finished_at} />
            ) : (
              <span className="text-fg-40">—</span>
            )
          }
        />
      </DetailSection>

      <DetailSection label="Target">
        <JsonBlock testId="audit-entry-target" value={entry.target ?? {}} />
      </DetailSection>

      <DetailSection label="Parameters">
        <JsonBlock testId="audit-entry-parameters" value={entry.parameters ?? {}} />
      </DetailSection>

      {entry.raw_tool_output_ref && (
        <DetailSection label="Raw tool output">
          <span className="font-mono text-2xs text-fg-80">{entry.raw_tool_output_ref}</span>
        </DetailSection>
      )}
    </div>
  );
}

/**
 * Hardened JSON block: we render `JSON.stringify` output inside a
 * `<pre>` — no `dangerouslySetInnerHTML`, no `eval`-style parsers,
 * no `innerHTML`. A hostile audit body can't escape into the DOM.
 */
function JsonBlock({ value, testId }: { value: unknown; testId: string }): JSX.Element {
  return (
    <pre
      data-testid={testId}
      className="max-h-72 overflow-x-auto rounded-sm border border-fg-20 bg-bg-inset p-3 font-mono text-2xs text-fg-80"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
