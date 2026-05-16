import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/lab/rogue-ap")({
  component: () => (
    <StubView
      title="Rogue AP"
      stage={7}
      description="hostapd-mana panel — choose target SSID, configure capture, fire only against engagement-allow-listed BSSIDs."
    />
  ),
});
