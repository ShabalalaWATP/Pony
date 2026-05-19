import { AlertTriangle, CheckCircle2, Download, FileDown, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { safeDownloadUrl } from "@/lib/safe-url";
import {
  type Engagement,
  type ReportFormat,
  useCreateReport,
  useReportStatus,
} from "@/services/api/labQueries";

const FORMATS: { id: ReportFormat; label: string; blurb: string }[] = [
  { id: "pdf", label: "PDF", blurb: "Engagement narrative + entity tables." },
  { id: "html", label: "HTML", blurb: "Same content as PDF, single self-contained file." },
  { id: "pcap", label: "PCAP", blurb: "Raw frames captured during the engagement window." },
  { id: "jsonl", label: "JSONL", blurb: "Append-only event stream — one JSON object per line." },
];

const QUICK_RANGES: { id: string; label: string; minutes: number }[] = [
  { id: "1h", label: "Last 1h", minutes: 60 },
  { id: "24h", label: "Last 24h", minutes: 24 * 60 },
  { id: "engagement", label: "Since engagement start", minutes: -1 },
];

interface ReportsPanelProps {
  engagement: Engagement;
}

interface ReportRow {
  /** Local ulid-like key so each request gets a stable row before we have a report_id. */
  key: string;
  reportId: string;
  format: ReportFormat;
  since: string;
  until: string;
  requestedAt: number;
}

/**
 * Engagement reports + exports panel.
 *
 * Lets the operator queue a report with `POST /engagements/{id}/reports`
 * and tracks each in-flight request in a local row. The row's status
 * comes from `useReportStatus`, which polls `GET .../{report_id}` every
 * 1.5s until the backend reports `ready` or `failed`. When ready, the
 * row exposes a download anchor pointing at the signed
 * `download_url` — auth cookies travel with the GET, so the operator
 * gets the file directly.
 *
 * Rows live only in this component's state — they survive across
 * format changes but reset when the engagement panel unmounts. The
 * audit log is the source of truth for what was generated when.
 */
export function ReportsPanel({ engagement }: ReportsPanelProps): JSX.Element {
  const create = useCreateReport();
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [since, setSince] = useState<string>(() => defaultSince(engagement));
  const [until, setUntil] = useState<string>(() => defaultUntil());
  const [rows, setRows] = useState<ReportRow[]>([]);

  // Reset the form's date range when the active engagement changes.
  // We intentionally depend on the engagement identity / start time only;
  // other fields on the engagement don't affect the form defaults.
  useEffect(() => {
    setSince(defaultSince(engagement));
    setUntil(defaultUntil());
    setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [engagement.id, engagement.started_at]);

  const applyRange = (mins: number): void => {
    if (mins < 0) {
      // "Since engagement start" — anchor `since` to the engagement.
      setSince(toLocalInput(engagement.started_at ?? new Date().toISOString()));
      setUntil(defaultUntil());
      return;
    }
    const now = new Date();
    const past = new Date(now.getTime() - mins * 60_000);
    setSince(toLocalInput(past.toISOString()));
    setUntil(toLocalInput(now.toISOString()));
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const sinceIso = fromLocalInput(since);
    const untilIso = fromLocalInput(until);
    if (!sinceIso || !untilIso) return;
    if (new Date(untilIso) <= new Date(sinceIso)) return;
    create.mutate(
      { engagementId: engagement.id, body: { format, since: sinceIso, until: untilIso } },
      {
        onSuccess: (data) => {
          setRows((prev) => [
            {
              key: `${data.report_id}-${Date.now()}`,
              reportId: data.report_id,
              format,
              since: sinceIso,
              until: untilIso,
              requestedAt: Date.now(),
            },
            ...prev,
          ]);
        },
      },
    );
  };

  const canSubmit =
    Boolean(since) && Boolean(until) && new Date(until) > new Date(since) && !create.isPending;

  return (
    <section
      data-testid="reports-panel"
      className="flex flex-col gap-3 rounded-md border border-fg-20 bg-bg-2 p-4"
    >
      <header className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
        <FileDown className="size-3" aria-hidden="true" />
        Reports + exports
      </header>

      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_1fr_auto]"
        onSubmit={handleSubmit}
        data-testid="report-create-form"
      >
        <label className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-fg-60">Format</span>
          <select
            aria-label="Report format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ReportFormat)}
            className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-2 text-sm"
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-fg-60">Since</span>
          <input
            aria-label="Report start"
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-fg-60">Until</span>
          <input
            aria-label="Report end"
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-2 text-sm"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={!canSubmit}>
            {create.isPending ? "Queuing…" : "Generate"}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs uppercase tracking-wide text-fg-60">Quick range:</span>
        {QUICK_RANGES.map((r) => (
          <Button
            key={r.id}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyRange(r.minutes)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      <FormatBlurb format={format} />

      {create.error && (
        <p role="alert" className="text-2xs text-accent-red">
          {create.error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-fg-60">
          No reports queued this session. Generate one above; the row appears here with live status.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset">
          {rows.map((row) => (
            <ReportRowItem key={row.key} engagementId={engagement.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ReportRowItemProps {
  engagementId: string;
  row: ReportRow;
}

function ReportRowItem({ engagementId, row }: ReportRowItemProps): JSX.Element {
  const query = useReportStatus(engagementId, row.reportId);
  const status = query.data?.status ?? "pending";
  // `download_url` is operator-facing — if a future backend change
  // ever returns an off-origin or non-/api URL, the link drops out
  // and the row stays at "ready" without a clickable download.
  const downloadUrl = safeDownloadUrl(query.data?.download_url);
  const downloadBlocked = status === "ready" && query.data?.download_url && !downloadUrl;
  const error = query.data?.error ?? query.error?.message;

  return (
    <li
      data-testid="report-row"
      data-status={status}
      className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
    >
      <Badge tone="violet" outline>
        {row.format}
      </Badge>
      <span className="font-mono text-2xs text-fg-60">#{row.reportId.slice(0, 8)}</span>
      <span className="text-2xs text-fg-60">
        <RelativeTime value={new Date(row.requestedAt).toISOString()} />
      </span>
      <span className="ml-auto flex items-center gap-2">
        <StatusBadge status={status} />
        {status === "ready" && downloadUrl ? (
          <a
            href={downloadUrl}
            // The download attribute hints the browser to save as a file.
            download
            className="inline-flex items-center gap-1.5 rounded-sm border border-fg-20 bg-bg-2 px-2 py-0.5 text-2xs text-fg-100 hover:border-fg-40"
            aria-label={`Download report ${row.reportId}`}
          >
            <Download className="size-3" aria-hidden="true" />
            Download
          </a>
        ) : null}
      </span>
      {downloadBlocked && (
        <p
          role="alert"
          data-testid="download-blocked"
          className="w-full text-2xs text-accent-amber"
        >
          Backend returned an unsafe download URL; download link suppressed. Check the audit log.
        </p>
      )}
      {status === "failed" && error && (
        <p role="alert" className="w-full text-2xs text-accent-red">
          {error}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: "pending" | "ready" | "failed" }): JSX.Element {
  if (status === "pending") {
    return (
      <Badge tone="amber" outline>
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        pending
      </Badge>
    );
  }
  if (status === "ready") {
    return (
      <Badge tone="green" outline>
        <CheckCircle2 className="size-3" aria-hidden="true" />
        ready
      </Badge>
    );
  }
  return (
    <Badge tone="red" outline>
      <XCircle className="size-3" aria-hidden="true" />
      failed
    </Badge>
  );
}

function FormatBlurb({ format }: { format: ReportFormat }): JSX.Element {
  const f = useMemo(() => FORMATS.find((x) => x.id === format), [format]);
  if (!f) return <></>;
  return (
    <div className="flex flex-col gap-1 text-2xs text-fg-60">
      <p>{f.blurb}</p>
      {format === "pcap" && (
        <p
          role="status"
          data-testid="pcap-empty-warning"
          className="flex items-center gap-1 text-accent-amber"
        >
          <AlertTriangle className="size-3" aria-hidden="true" />
          PCAP exports currently return an empty capture container — packet capture storage hasn't
          landed on the backend yet.
        </p>
      )}
    </div>
  );
}

function defaultUntil(): string {
  return toLocalInput(new Date().toISOString());
}

function defaultSince(engagement: Engagement): string {
  // Default to the engagement's start time if known; otherwise 24h ago.
  if (engagement.started_at) return toLocalInput(engagement.started_at);
  return toLocalInput(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
}

/** Convert an ISO datetime to a `<input type="datetime-local">` value. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** Inverse of `toLocalInput`: parse a `datetime-local` string back to ISO. */
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
