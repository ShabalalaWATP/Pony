import { createFileRoute } from "@tanstack/react-router";
import { AlertsView } from "@/components/alerts/AlertsView";

export const Route = createFileRoute("/_shell/alerts/")({
  component: AlertsView,
});
