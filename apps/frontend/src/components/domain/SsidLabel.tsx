import { cn } from "@/lib/cn";

interface SsidLabelProps {
  /**
   * SSID value. `null` / `undefined` / empty string all render as the
   * hidden marker. The backend treats hidden SSIDs as `null`; some
   * sensors and capture sources emit empty strings instead, so we
   * treat both the same way.
   */
  ssid: string | null | undefined;
  /** Adds `truncate` so the label degrades gracefully in narrow cells. */
  truncate?: boolean;
  /** Optional extra Tailwind classes — applied to both rendered shapes. */
  className?: string;
  /** Optional data-testid passthrough. */
  testId?: string;
}

/**
 * Single source of truth for rendering an access point's SSID label.
 *
 * Used across NetworksView, MapView, EventsView, OverviewEventStream,
 * and the AP detail surfaces so the hidden-SSID treatment (italic,
 * muted foreground, `<hidden>` literal) stays consistent everywhere.
 * Before this component existed, each surface re-implemented the
 * fallback inline and the styling drifted (italic vs not, fg-40 vs
 * fg-60, etc.).
 */
export function SsidLabel({ ssid, truncate, className, testId }: SsidLabelProps): JSX.Element {
  const hidden = !ssid;
  return (
    <span
      data-testid={testId}
      className={cn(
        truncate && "truncate",
        hidden ? "italic text-fg-40" : "text-fg-100",
        className,
      )}
    >
      {hidden ? "<hidden>" : ssid}
    </span>
  );
}
