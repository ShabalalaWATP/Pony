import { createFileRoute } from "@tanstack/react-router";
import { StubView } from "@/views/StubView";

export const Route = createFileRoute("/_shell/engagements/$id")({
  component: EngagementDetail,
});

function EngagementDetail(): JSX.Element {
  const { id } = Route.useParams();
  return (
    <StubView
      title={`Engagement ${id}`}
      stage={7}
      description="Scope rules, target allow-list, append-only audit log for active actions inside this engagement."
    />
  );
}
