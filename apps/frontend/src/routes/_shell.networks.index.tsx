import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/networks/")({
  component: () => (
    <StubView
      title="Networks"
      stage={5}
      description="Virtualised AP table with SSID/BSSID/vendor/channel/encryption/RSSI/client-count and a detail drawer."
    />
  ),
});
