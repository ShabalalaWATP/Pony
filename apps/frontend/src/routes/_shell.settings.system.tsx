import { createFileRoute } from "@tanstack/react-router";
import { SystemView } from "@/components/settings/SystemView";

export const Route = createFileRoute("/_shell/settings/system")({
  component: SystemView,
});
