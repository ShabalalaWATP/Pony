import { createFileRoute } from "@tanstack/react-router";
import { AlertRulesView } from "@/components/alerts/AlertRulesView";

export const Route = createFileRoute("/_shell/alerts/rules")({
  component: AlertRulesView,
});
