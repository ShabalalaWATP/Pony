import { Button } from "@/components/ui/Button";
import { DetailRow, DetailSection } from "@/components/ui/DetailGrid";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { InsightCard } from "@/components/insights/InsightCard";
import type { Alert } from "@/services/api/queries";

interface AlertDetailProps {
  alert: Alert;
  onAck: () => void;
  acking: boolean;
}

/**
 * Alert detail drawer body. Shows identity, related entities,
 * acknowledgement state (with the Ack button if not yet acked), and
 * the LLM-generated alert-context insight (gracefully unavailable
 * when LLM_ENABLED=false).
 *
 * Extracted from `AlertsView.tsx` so the parent stays under the
 * 400-LOC ceiling and so the detail body can be tested in
 * isolation without standing up the full alerts table.
 */
export function AlertDetail({ alert, onAck, acking }: AlertDetailProps): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection label="Identity">
        <DetailRow
          label="ID"
          value={<span className="font-mono text-xs text-fg-80">{alert.id}</span>}
        />
        <DetailRow
          label="Rule"
          value={<span className="font-mono text-xs text-fg-80">{alert.rule_id}</span>}
        />
        <DetailRow label="Severity" value={<AlertSeverityChip severity={alert.severity} />} />
      </DetailSection>

      <DetailSection label="Related entities">
        {(alert.related_entities ?? []).length === 0 ? (
          <span className="text-xs text-fg-60">none</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {(alert.related_entities ?? []).map((e) => (
              <li key={e} className="font-mono text-xs text-fg-100">
                {e}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection label="Acknowledgement">
        {alert.acked_at ? (
          <>
            <DetailRow label="When" value={<RelativeTime value={alert.acked_at} />} />
            <DetailRow
              label="By"
              value={
                <span className="font-mono text-xs text-fg-80">{alert.acked_by ?? "unknown"}</span>
              }
            />
          </>
        ) : (
          <Button onClick={onAck} disabled={acking}>
            {acking ? "Acking…" : "Acknowledge"}
          </Button>
        )}
      </DetailSection>

      <InsightCard kind="alert_context" entityId={alert.id} />
    </div>
  );
}
