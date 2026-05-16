import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/networks/$bssid")({
  component: NetworkDetail,
});

function NetworkDetail(): JSX.Element {
  const { bssid } = Route.useParams();
  return (
    <StubView
      title={`AP ${bssid}`}
      stage={5}
      description="Signal-strength chart, associated clients, probe responses, raw frame samples, PCAP export."
    />
  );
}
