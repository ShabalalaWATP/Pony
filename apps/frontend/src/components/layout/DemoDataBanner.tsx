import { Beaker, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDemoStatus } from "@/services/api/systemQueries";

const DISMISS_KEY = "cp-demo-banner-dismissed";

/**
 * Thin amber banner that surfaces whenever the backend reports any
 * synthetic seed records present (`system/demo-status > 0`).
 *
 * The banner exists so an operator inspecting a list view doesn't act
 * on a synthetic device / engagement / alert thinking it's real.
 * Synthetic records are stamped on the wire (`synthetic: true`) and
 * also prefixed in the id/MAC — this is the in-UI reminder.
 *
 * Dismissal is per-session (sessionStorage). Each fresh sign-in
 * re-arms it so an operator who logs in after a colleague seeded data
 * still sees the notice.
 */
export function DemoDataBanner(): JSX.Element | null {
  const query = useDemoStatus();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  const count = query.data?.synthetic_records ?? 0;
  if (count === 0 || dismissed) return null;

  const handleDismiss = (): void => {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-data-banner"
      className="flex items-center gap-3 border-b border-accent-amber/40 bg-accent-amber/10 px-4 py-1.5 text-xs text-accent-amber"
    >
      <Beaker className="size-3.5" aria-hidden="true" />
      <span className="font-medium uppercase tracking-wide">Demo data loaded</span>
      <span className="text-fg-80">
        <span className="font-mono">{count}</span> synthetic records are visible alongside any real
        sensor data. Run <code className="font-mono text-accent-amber">make unseed-demo</code> to
        clear them.
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-6"
        onClick={handleDismiss}
        aria-label="Dismiss demo data banner"
        data-testid="demo-data-banner-dismiss"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
