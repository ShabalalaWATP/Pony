import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

interface RelativeTimeProps {
  value: Date | number | string;
  className?: string;
  /** Threshold (seconds) above which the row should look stale. Default 30s. */
  staleAfterSec?: number;
  /** Threshold (seconds) above which the row should look offline. Default 300s. */
  offlineAfterSec?: number;
}

function toMs(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function format(deltaSec: number): string {
  if (deltaSec < 1) return "now";
  if (deltaSec < 60) return `${Math.floor(deltaSec)}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

/**
 * Auto-updating relative timestamp ("12s ago"). Per design spec §9, stale
 * data must visually degrade — the colour shifts amber then red as time
 * passes so the operator never wonders if they're looking at frozen state.
 */
export function RelativeTime({
  value,
  className,
  staleAfterSec = 30,
  offlineAfterSec = 300,
}: RelativeTimeProps): JSX.Element {
  const ts = toMs(value);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const delta = (now - ts) / 1_000;
  const tone =
    delta < staleAfterSec
      ? "text-fg-60"
      : delta < offlineAfterSec
        ? "text-accent-amber"
        : "text-accent-red";

  const absolute = new Date(ts).toISOString();

  return (
    <Tooltip content={absolute}>
      <time
        dateTime={new Date(ts).toISOString()}
        className={cn("font-mono text-2xs tabular-nums", tone, className)}
      >
        {format(delta)}
      </time>
    </Tooltip>
  );
}
