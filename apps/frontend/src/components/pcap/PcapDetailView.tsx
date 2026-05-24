import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type Finding,
  type FindingSeverity,
  usePcapAnalysis,
  usePcapFindings,
} from "@/services/api/pcapQueries";
import { FindingEvidence } from "./FindingEvidence";

interface PcapDetailViewProps {
  engagementId: string;
  pcapId: string;
}

/**
 * Findings view for one PCAP. Pulls the analysis summary (status +
 * per-kind counts) and the full findings list, dispatches each
 * finding's evidence into the matching renderer. Polls while the
 * analysis is still running so the operator sees rows appear without
 * a refresh.
 */
export function PcapDetailView({ engagementId, pcapId }: PcapDetailViewProps): JSX.Element {
  const analysis = usePcapAnalysis(engagementId, pcapId);
  const findingsQuery = usePcapFindings(engagementId, pcapId);

  const findings = findingsQuery.data?.items ?? [];
  const status = analysis.data?.analysis?.status;
  const counts = analysis.data?.finding_counts ?? {};

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Capture findings">
        <Button asChild variant="ghost" size="sm">
          <Link to="/engagements/$id" params={{ id: engagementId }} data-testid="pcap-back-link">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to engagement
          </Link>
        </Button>
      </PageHeader>

      <AnalysisHeader status={status ?? null} counts={counts} />

      {findingsQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : findings.length === 0 ? (
        <EmptyState
          title={status === "running" ? "Analysis in progress" : "No findings"}
          description={
            status === "running"
              ? "Findings will appear here as the tshark filters complete."
              : "This capture didn't produce any findings — try a different filter set or check the analysis status above."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="findings-list">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface AnalysisHeaderProps {
  status: string | null;
  counts: Record<string, number>;
}

function AnalysisHeader({ status, counts }: AnalysisHeaderProps): JSX.Element {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <section
      data-testid="pcap-analysis-header"
      className="flex flex-wrap items-center gap-3 rounded-md border border-fg-20 bg-bg-2 p-3 text-xs"
    >
      <span className="text-2xs uppercase tracking-wide text-fg-60">Analysis</span>
      <Badge tone={statusTone(status)} outline>
        {status ?? "unknown"}
      </Badge>
      <span className="text-fg-80">
        {total} finding{total === 1 ? "" : "s"}
      </span>
      {Object.entries(counts).map(([k, n]) => (
        <Badge key={k} tone="neutral" outline>
          {k.replace(/_/g, " ")} · {n}
        </Badge>
      ))}
    </section>
  );
}

function statusTone(status: string | null): "neutral" | "cyan" | "green" | "red" {
  switch (status) {
    case "running":
      return "cyan";
    case "completed":
      return "green";
    case "partial":
      return "neutral";
    case "failed":
      return "red";
    default:
      return "neutral";
  }
}

function FindingCard({ finding }: { finding: Finding }): JSX.Element {
  return (
    <li
      data-testid="finding-card"
      data-finding-id={finding.id}
      data-finding-kind={finding.kind}
      className="rounded-md border border-fg-20 bg-bg-2 p-3"
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(finding.severity)} outline>
          {finding.severity}
        </Badge>
        <span className="font-mono text-2xs uppercase tracking-wide text-fg-60">
          {finding.kind.replace(/_/g, " ")}
        </span>
        <span className="flex-1 truncate text-sm text-fg-100">{finding.summary}</span>
        <span className="text-2xs text-fg-60">
          <RelativeTime value={finding.generated_at} />
        </span>
      </header>
      <FindingEvidence kind={finding.kind} evidence={finding.evidence} />
    </li>
  );
}

function severityTone(s: FindingSeverity): "neutral" | "cyan" | "amber" | "red" {
  switch (s) {
    case "info":
      return "neutral";
    case "low":
      return "cyan";
    case "medium":
      return "amber";
    case "high":
      return "red";
  }
}
