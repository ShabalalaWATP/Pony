import { Link } from "@tanstack/react-router";
import { FileUp, Loader2, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/domain/EmptyState";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { type Pcap, type PcapStatus, useAnalyzePcap, usePcaps } from "@/services/api/pcapQueries";
import { PcapUploadDrawer } from "./PcapUploadDrawer";
import { PcapDeleteConfirmDialog } from "./PcapDeleteConfirmDialog";

interface PcapSectionProps {
  engagementId: string;
}

/**
 * Per-engagement PCAP list. Shows uploaded captures with their
 * current analysis status, an "Analyze" button to kick off tshark,
 * a delete affordance behind typed-confirm, and an "Upload" button
 * that opens the upload drawer.
 *
 * Designed to slot into the engagement detail view as a section.
 * Sits alongside the existing engagement metadata + allow-list
 * surfaces — the operator stays on one page for the whole capture
 * lifecycle.
 */
export function PcapSection({ engagementId }: PcapSectionProps): JSX.Element {
  const query = usePcaps(engagementId);
  const analyze = useAnalyzePcap(engagementId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pcap | null>(null);

  const items = query.data?.items ?? [];

  return (
    <section className="flex flex-col gap-3" data-testid="pcap-section">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xs uppercase tracking-wide text-fg-60">Packet captures</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setUploadOpen(true)}
          data-testid="pcap-upload-button"
        >
          <FileUp className="size-3.5" aria-hidden="true" />
          Upload PCAP
        </Button>
      </header>

      {query.isLoading ? (
        <div className="text-xs text-fg-60">Loading captures…</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No captures uploaded yet"
          description="Drop a .pcap or .pcapng (up to 100 MB) to run a tshark analysis against this engagement."
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="pcap-list">
          {items.map((p) => (
            <PcapRow
              key={p.id}
              pcap={p}
              engagementId={engagementId}
              analyzing={analyze.isPending}
              onAnalyze={() => analyze.mutate(p.id)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))}
        </ul>
      )}

      <PcapUploadDrawer
        engagementId={engagementId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />
      <PcapDeleteConfirmDialog
        engagementId={engagementId}
        pcap={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </section>
  );
}

interface PcapRowProps {
  pcap: Pcap;
  engagementId: string;
  analyzing: boolean;
  onAnalyze: () => void;
  onDelete: () => void;
}

function PcapRow({
  pcap,
  engagementId,
  analyzing,
  onAnalyze,
  onDelete,
}: PcapRowProps): JSX.Element {
  const sizeMb = (pcap.size_bytes / 1_048_576).toFixed(1);
  return (
    <li
      data-testid="pcap-row"
      data-pcap-id={pcap.id}
      className="flex flex-wrap items-center gap-3 rounded-md border border-fg-20 bg-bg-2 px-3 py-2 text-sm"
    >
      <FileUp className="size-4 shrink-0 text-fg-60" aria-hidden="true" />
      <Link
        to="/engagements/$engagementId/pcaps/$pcapId"
        params={{ engagementId, pcapId: pcap.id }}
        className="min-w-0 flex-1 truncate text-fg-100 hover:underline"
        data-testid="pcap-link"
      >
        {pcap.filename_sanitized}
      </Link>
      <span className="text-xs text-fg-60">{sizeMb} MB</span>
      <StatusBadge status={pcap.status} />
      <span className="text-xs text-fg-60">
        <RelativeTime value={pcap.uploaded_at} />
      </span>
      {pcap.status === "uploaded" && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onAnalyze}
          disabled={analyzing}
          data-testid="pcap-analyze-button"
        >
          {analyzing ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3" aria-hidden="true" />
          )}
          Analyze
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        aria-label={`Delete ${pcap.filename_sanitized}`}
        data-testid="pcap-delete-button"
      >
        <Trash2 className="size-3" aria-hidden="true" />
      </Button>
    </li>
  );
}

const STATUS_TONE: Record<PcapStatus, "neutral" | "cyan" | "green" | "red"> = {
  uploaded: "neutral",
  analyzing: "cyan",
  analyzed: "green",
  failed: "red",
};

function StatusBadge({ status }: { status: PcapStatus }): JSX.Element {
  return (
    <Badge tone={STATUS_TONE[status]} outline data-testid="pcap-status">
      {status}
    </Badge>
  );
}
