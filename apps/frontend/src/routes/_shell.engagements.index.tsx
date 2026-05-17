import { createFileRoute } from "@tanstack/react-router";
import { EngagementsView } from "@/components/engagements/EngagementsView";

export const Route = createFileRoute("/_shell/engagements/")({
  component: EngagementsView,
});
