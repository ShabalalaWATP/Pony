import { createFileRoute } from "@tanstack/react-router";
import { EvilTwinsView } from "@/components/networks/EvilTwinsView";

export const Route = createFileRoute("/_shell/networks/evil-twins")({
  component: EvilTwinsView,
});
