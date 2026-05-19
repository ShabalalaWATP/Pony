import { createFileRoute } from "@tanstack/react-router";
import { EngagementDetailView } from "@/components/engagements/EngagementDetailView";

export const Route = createFileRoute("/_shell/engagements/$id")({
  component: EngagementDetail,
});

function EngagementDetail(): JSX.Element {
  const { id } = Route.useParams();
  return <EngagementDetailView engagementId={id} />;
}
