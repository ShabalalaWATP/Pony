import { useEffect, useState } from "react";
import { LiveDot } from "@/components/domain/LiveDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { useLastMessageAt, useOperatorConnection } from "@/services/ws/hooks";

const FRESH_WINDOW_MS = 5_000;
const IDLE_WINDOW_MS = 60_000;

function formatAge(ms: number): string {
  if (ms < 1_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

/**
 * Topbar pill that surfaces the operator-WebSocket connection state +
 * data freshness in one glance.
 *
 * Three states map to the existing `LiveDot` palette so the visual
 * vocabulary stays consistent with the rest of the app:
 *
 * - `live`    — socket is open AND a message arrived within the last
 *               5s (cyan, pulsing)
 * - `stale`   — socket is open, last message older than 5s but
 *               younger than 60s (amber, static)
 * - `offline` — socket is closed/idle, OR open with no message for
 *               60s+ (fg-40, static)
 *
 * Hovering the pill shows the exact last-message age and raw socket
 * state, useful for diagnosing whether silence is a network problem
 * or just no events flowing.
 */
export function OperatorConnectionPill(): JSX.Element {
  const { state } = useOperatorConnection();
  const lastAt = useLastMessageAt();
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate freshness on a slow tick so the dot collapses live→stale
  // even when no new messages arrive.
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(handle);
  }, []);

  const age = lastAt == null ? null : now - lastAt;
  const dotState: "live" | "stale" | "offline" =
    state !== "open"
      ? "offline"
      : age == null || age >= IDLE_WINDOW_MS
        ? "offline"
        : age < FRESH_WINDOW_MS
          ? "live"
          : "stale";

  const labelByState: Record<typeof dotState, string> = {
    live: "Live",
    stale: "Stale",
    offline: state === "open" ? "Idle" : "Offline",
  };

  const tooltipBody =
    age == null
      ? state === "open"
        ? "Connected — awaiting first event."
        : `Operator WebSocket is ${state}.`
      : `Last event ${formatAge(age)}. Socket ${state}.`;

  return (
    <Tooltip content={tooltipBody}>
      <span data-testid="operator-connection-pill" data-state={dotState}>
        <LiveDot state={dotState} label={labelByState[dotState]} />
      </span>
    </Tooltip>
  );
}
