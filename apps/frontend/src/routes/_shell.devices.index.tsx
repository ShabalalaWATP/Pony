import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/devices/")({
  component: () => (
    <StubView
      title="Devices"
      stage={5}
      description="Virtualised client table with MAC/vendor/probes/associated AP/RSSI and a per-device detail drawer."
    />
  ),
});
