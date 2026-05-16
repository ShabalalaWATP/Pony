import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/devices/$mac")({
  component: DeviceDetail,
});

function DeviceDetail(): JSX.Element {
  const { mac } = Route.useParams();
  return (
    <StubView
      title={`Client ${mac}`}
      stage={5}
      description="Probe history timeline, AP associations, signal sparkline, and Watch-this-device alert rule helper."
    />
  );
}
