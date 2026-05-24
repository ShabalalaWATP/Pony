import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { InsightCard } from "./InsightCard";
import type { InsightKind } from "@/services/api/insightQueries";

interface OnDemandInsightProps {
  kind: InsightKind;
  entityId: string;
  /** Button label before the insight is requested. */
  buttonLabel?: string;
}

/**
 * Wrapper for insights that should NOT auto-fetch on mount —
 * AP descriptions and PCAP-finding explanations, where there are
 * too many entities to spec-generate for every list cell. The
 * operator clicks the button, then `<InsightCard>` mounts and fires
 * the fetch.
 *
 * Once requested for a session, the insight stays expanded — the
 * server-side cache makes subsequent reads instant.
 */
export function OnDemandInsight({
  kind,
  entityId,
  buttonLabel = "Explain with AI",
}: OnDemandInsightProps): JSX.Element {
  const [requested, setRequested] = useState(false);
  if (!requested) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setRequested(true)}
        data-testid="on-demand-insight-button"
        data-insight-kind={kind}
      >
        <Sparkles className="size-3.5 text-accent-violet" aria-hidden="true" />
        {buttonLabel}
      </Button>
    );
  }
  return <InsightCard kind={kind} entityId={entityId} />;
}
