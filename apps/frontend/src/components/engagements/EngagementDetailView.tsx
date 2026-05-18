import { Link } from "@tanstack/react-router";
import { ArrowLeft, PlayCircle, ShieldCheck, ShieldX, StopCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { EndpointHint } from "@/components/ui/EndpointHint";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type AllowedTarget,
  type Engagement,
  useAllowList,
  useEndEngagement,
  useEngagement,
  useResumeEngagement,
} from "@/services/api/labQueries";

interface EngagementDetailViewProps {
  engagementId: string;
}

function isActive(e: Engagement): boolean {
  return !e.ended_at;
}

/**
 * `/engagements/$id` detail page.
 *
 * Single-engagement read-mostly view: metadata, scope rules, the
 * current allow-list, and lifecycle controls (End if active, Resume
 * if ended). Allow-list editing lives on `/lab` against the active
 * engagement only — this page is for inspecting any engagement, even
 * an ended one, without leaving the operator stranded.
 *
 * 404 → "not found" empty state with a back-link; 401/403 →
 * "sign in required" empty state.
 */
export function EngagementDetailView({ engagementId }: EngagementDetailViewProps): JSX.Element {
  const query = useEngagement(engagementId);
  const allowList = useAllowList(engagementId);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="engagement-detail-loading">
        <PageHeader title="Engagement" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.error?.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState
          title="Engagement not found"
          description={`No engagement with id ${engagementId}. It may have been removed.`}
        />
      </div>
    );
  }

  if (query.error?.status === 401 || query.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState
          title="Sign in required"
          description="Engagement detail needs an authenticated session."
        />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState title="Unable to load engagement" description={query.error?.message} />
      </div>
    );
  }

  const engagement = query.data;
  const active = isActive(engagement);

  return (
    <div className="flex flex-col gap-6" data-testid="engagement-detail">
      <BackLink />
      <PageHeader title={engagement.name}>
        {active ? (
          <Badge tone="green" outline>
            <ShieldCheck className="size-3" aria-hidden="true" />
            active
          </Badge>
        ) : (
          <Badge tone="neutral" outline>
            ended
          </Badge>
        )}
        <EndpointHint>{`/api/v1/engagements/${engagement.id}`}</EndpointHint>
      </PageHeader>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DetailSection label="Identity">
          <DetailRow
            label="ID"
            value={<span className="font-mono text-xs text-fg-80">{engagement.id}</span>}
          />
          <DetailRow label="Name" value={engagement.name} />
          <DetailRow
            label="Started"
            value={
              engagement.started_at ? (
                <RelativeTime value={engagement.started_at} />
              ) : (
                <span className="text-fg-40">—</span>
              )
            }
          />
          <DetailRow
            label="Ended"
            value={
              engagement.ended_at ? (
                <RelativeTime value={engagement.ended_at} />
              ) : (
                <span className="text-fg-40">—</span>
              )
            }
          />
        </DetailSection>

        <DetailSection label="Scope rules">
          <ScopeRulesList rules={engagement.scope_rules ?? []} />
        </DetailSection>
      </section>

      <DetailSection label="Allow-list">
        <AllowListSummary query={allowList} active={active} />
      </DetailSection>

      <DetailSection label="Lifecycle">
        {active ? <EndAction engagement={engagement} /> : <ResumeAction engagement={engagement} />}
      </DetailSection>
    </div>
  );
}

function BackLink(): JSX.Element {
  return (
    <Link
      to="/engagements"
      className="inline-flex w-fit items-center gap-1.5 text-2xs text-fg-60 hover:text-fg-100"
      aria-label="Back to engagements"
    >
      <ArrowLeft className="size-3" aria-hidden="true" />
      All engagements
    </Link>
  );
}

function ScopeRulesList({ rules }: { rules: Record<string, unknown>[] }): JSX.Element {
  if (rules.length === 0) {
    return <p className="text-xs text-fg-60">No scope rules recorded for this engagement.</p>;
  }
  return (
    <ul
      data-testid="engagement-scope-rules"
      className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset"
    >
      {rules.map((rule, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs">
          {Object.entries(rule).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-2xs uppercase tracking-wide text-fg-60">{k}</span>
              <span className="font-mono text-fg-100">{String(v)}</span>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

interface AllowListSummaryProps {
  query: ReturnType<typeof useAllowList>;
  active: boolean;
}

function AllowListSummary({ query, active }: AllowListSummaryProps): JSX.Element {
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="engagement-allow-list-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (query.error) {
    if (query.error.status === 401 || query.error.status === 403) {
      return (
        <p className="text-xs text-fg-60">
          You don&apos;t have permission to view this engagement&apos;s allow-list.
        </p>
      );
    }
    return (
      <p role="alert" className="text-xs text-accent-red">
        Unable to load allow-list: {query.error.message}
      </p>
    );
  }
  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-xs text-fg-60">No targets on file.</p>
      ) : (
        <ul
          data-testid="engagement-allow-list"
          className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset"
        >
          {items.map((t) => (
            <AllowListRow key={`${t.kind}:${t.value}`} target={t} />
          ))}
        </ul>
      )}
      {active && (
        <p className="text-2xs text-fg-60">
          Allow-list editing for the active engagement happens on{" "}
          <Link className="text-mode underline-offset-2 hover:underline" to="/lab">
            /lab
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function AllowListRow({ target }: { target: AllowedTarget }): JSX.Element {
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-xs" data-testid="allow-list-row">
      <Badge tone="neutral" outline>
        {target.kind.replace(/_/g, " ")}
      </Badge>
      {target.kind === "ssid" ? (
        <span className="truncate font-mono text-fg-100">{target.value}</span>
      ) : (
        <MacAddress value={target.value} />
      )}
    </li>
  );
}

function EndAction({ engagement }: { engagement: Engagement }): JSX.Element {
  const end = useEndEngagement();
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === engagement.name.trim();
  const canSubmit = ready && !end.isPending && !end.isSuccess;

  return (
    <form
      className="relative flex flex-col gap-2 rounded-md border border-accent-red/40 bg-accent-red/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) end.mutate(engagement.id);
      }}
      data-testid="engagement-end-form"
    >
      <CornerBrackets inset="-0.35rem" tone="red" />
      <p className="flex items-center gap-2 text-2xs text-accent-red">
        <ShieldX className="size-3.5" aria-hidden="true" />
        Type the engagement name to end it. Cancels every active lab command and writes an audit
        entry.
      </p>
      <Input
        aria-label="Engagement name to confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={engagement.name}
        aria-invalid={typed !== "" && !ready}
        maxLength={120}
      />
      {end.error && (
        <p role="alert" className="text-2xs text-accent-red">
          {end.error.message}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={!canSubmit}>
          <StopCircle className="size-3.5" aria-hidden="true" />
          {end.isPending ? "Ending…" : "End engagement"}
        </Button>
      </div>
    </form>
  );
}

function ResumeAction({ engagement }: { engagement: Engagement }): JSX.Element {
  const resume = useResumeEngagement();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-fg-20 bg-bg-inset p-3">
      <p className="text-2xs text-fg-60">
        Resuming brings this engagement back to active. Refused (409) if another engagement is
        already active.
      </p>
      {resume.error && (
        <p role="alert" className="text-2xs text-accent-red">
          {resume.error.message}
        </p>
      )}
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={resume.isPending || resume.isSuccess}
          onClick={() => resume.mutate(engagement.id)}
          data-testid="engagement-resume-btn"
        >
          <PlayCircle className="size-3.5" aria-hidden="true" />
          {resume.isPending ? "Resuming…" : "Resume"}
        </Button>
      </div>
    </div>
  );
}
