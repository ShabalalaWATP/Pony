import { type ColumnDef } from "@tanstack/react-table";
import { PlayCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type Engagement,
  useEngagementsList,
  useResumeEngagement,
} from "@/services/api/labQueries";

function isActive(e: Engagement): boolean {
  return !e.ended_at;
}

/**
 * Engagements list view.
 *
 * Reads `GET /api/v1/engagements` so operators can see every
 * engagement (active + ended) and resume an ended one when no other
 * engagement is currently active. Active engagements get a green
 * "active" pill; ended engagements get a Resume button.
 *
 * Allow-list management + report generation live on the lab page once
 * the engagement is active; this view is the bare list / lifecycle
 * surface, intentionally narrow.
 */
export function EngagementsView(): JSX.Element {
  const query = useEngagementsList({ limit: 500 });
  const resume = useResumeEngagement();
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  const onResume = (engagement: Engagement): void => {
    setError(null);
    resume.mutate(engagement.id, {
      onError: (err) => setError(err.message),
    });
  };

  const columns = useMemo<ColumnDef<Engagement, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (ctx) => <span className="truncate text-fg-100">{ctx.getValue<string>()}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: (ctx) =>
          isActive(ctx.row.original) ? (
            <Badge tone="green" outline>
              <ShieldCheck className="size-3" aria-hidden="true" />
              active
            </Badge>
          ) : (
            <Badge tone="neutral" outline>
              ended
            </Badge>
          ),
        size: 120,
      },
      {
        accessorKey: "started_at",
        header: "Started",
        cell: (ctx) => {
          const v = ctx.getValue<string | undefined>();
          return v ? <RelativeTime value={v} /> : <span className="text-fg-40">—</span>;
        },
        size: 130,
      },
      {
        accessorKey: "ended_at",
        header: "Ended",
        cell: (ctx) => {
          const v = ctx.getValue<string | null | undefined>();
          return v ? <RelativeTime value={v} /> : <span className="text-fg-40">—</span>;
        },
        size: 130,
      },
      {
        id: "id",
        header: "ID",
        cell: (ctx) => <span className="font-mono text-2xs text-fg-60">{ctx.row.original.id}</span>,
        size: 220,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (ctx) => {
          const engagement = ctx.row.original;
          if (isActive(engagement)) return null;
          const pending = resume.isPending && resume.variables === engagement.id;
          return (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation();
                onResume(engagement);
              }}
              aria-label={`Resume ${engagement.name}`}
            >
              <PlayCircle className="size-3.5" aria-hidden="true" />
              {pending ? "Resuming…" : "Resume"}
            </Button>
          );
        },
        size: 130,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs are stable
    [resume.isPending, resume.variables],
  );

  if (query.error?.status === 401 || query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Engagements" />
        <EmptyState
          title="Sign in required"
          description="Engagements need an authenticated session."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Engagements" total={query.data?.total} />

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"
        >
          {error}
        </div>
      )}

      <DataTable<Engagement>
        data={items}
        columns={columns}
        getRowId={(row) => row.id}
        label="Engagements"
        maxHeight={520}
        emptyState={
          <EmptyState
            title="No engagements yet"
            description="Create one from a runbook or the audit log to scope lab activity."
          />
        }
      />
    </div>
  );
}
