import { OverviewEventStream } from "@/components/overview/OverviewEventStream";
import { OverviewKPIs } from "@/components/overview/OverviewKPIs";
import { OverviewRecentAlerts } from "@/components/overview/OverviewRecentAlerts";
import { OverviewSignalHistogram } from "@/components/overview/OverviewSignalHistogram";

/**
 * Operator home. KPI tiles + live event stream + signal histogram +
 * recent-alerts placeholder, on a single non-scrolling-on-1440p layout.
 */
export function Overview(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg-100">Overview</h1>
        <span className="text-2xs uppercase tracking-wide text-fg-60">live</span>
      </header>

      <OverviewKPIs />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OverviewEventStream />
        </div>
        <OverviewRecentAlerts />
      </div>

      <OverviewSignalHistogram />
    </div>
  );
}
