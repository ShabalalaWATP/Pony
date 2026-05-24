import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/domain/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const Route = createFileRoute("/_shell/engagements/$engagementId/pcaps/$pcapId")({
  component: PcapDetailViewStub,
});

/**
 * Placeholder route for the PCAP findings detail view. Frontend
 * Slice 2B replaces this stub with the full findings display
 * (protocol hierarchy, conversations, deauth bursts, etc).
 */
function PcapDetailViewStub(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Capture findings" />
      <EmptyState
        title="Findings view coming next"
        description="Slice 2B wires the per-finding evidence renderers into this route. The list and upload affordance on the engagement detail are functional."
      />
    </div>
  );
}
