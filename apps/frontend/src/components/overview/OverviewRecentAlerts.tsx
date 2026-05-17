import { Bell } from "lucide-react";
import { EmptyState } from "@/components/domain/EmptyState";

/**
 * Recent-alerts panel.
 *
 * Backend has the `Alert` schema but no `/api/v1/alerts` list endpoint
 * yet — when Codex ships one, this swaps to a real `useAlertsList`
 * query + the `alerts.fire` WS topic. Until then the panel renders a
 * tasteful placeholder so the layout doesn't pop later.
 */
export function OverviewRecentAlerts(): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-fg-20 bg-bg-2">
      <div className="flex items-center justify-between border-b border-fg-20 px-4 py-2.5">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
          <Bell className="size-3" aria-hidden="true" />
          Recent alerts
        </div>
        <div className="font-mono text-2xs text-fg-60">backend pending</div>
      </div>
      <EmptyState
        title="No alerts surface yet"
        description="The alerts inbox lights up once the backend exposes a list endpoint and the alerts.fire WebSocket topic."
      />
    </div>
  );
}
