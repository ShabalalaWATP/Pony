import { InsightCard } from "@/components/insights/InsightCard";
import { useActiveEngagement } from "@/services/api/labQueries";

/**
 * Surfaces the LLM-generated engagement summary on the Overview
 * page when an engagement is currently active. Renders nothing when
 * there isn't one — Overview shouldn't be cluttered with a "no
 * engagement" placeholder for what's an entirely optional view.
 */
export function OverviewEngagementInsight(): JSX.Element | null {
  const query = useActiveEngagement();
  const engagement = query.data;
  if (!engagement) return null;
  return <InsightCard kind="engagement_summary" entityId={engagement.id} />;
}
