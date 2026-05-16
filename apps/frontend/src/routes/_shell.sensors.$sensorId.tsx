import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/sensors/$sensorId")({
  component: SensorDetail,
});

function SensorDetail(): JSX.Element {
  const { sensorId } = Route.useParams();
  return (
    <StubView
      title={`Sensor ${sensorId}`}
      stage={5}
      description="Live event stream (xterm.js), capabilities, channel hop schedule, and 24h health history."
    />
  );
}
