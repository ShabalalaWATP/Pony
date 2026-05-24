import { createFileRoute } from "@tanstack/react-router";
import { InsightsAdminView } from "@/components/settings/InsightsAdminView";

export const Route = createFileRoute("/_shell/settings/insights")({
  component: InsightsAdminView,
});
