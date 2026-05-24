import { createFileRoute } from "@tanstack/react-router";
import { PcapDetailView } from "@/components/pcap/PcapDetailView";

export const Route = createFileRoute("/_shell/engagements/$engagementId/pcaps/$pcapId")({
  component: PcapDetailRoute,
});

function PcapDetailRoute(): JSX.Element {
  const { engagementId, pcapId } = Route.useParams();
  return <PcapDetailView engagementId={engagementId} pcapId={pcapId} />;
}
