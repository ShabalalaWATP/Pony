import { Badge } from "@/components/ui/Badge";

interface ChannelBadgeProps {
  channel: number;
  /** Band label — conventionally "2.4", "5", or "6". */
  band?: string;
  className?: string;
}

/** Compact channel + band indicator. */
export function ChannelBadge({ channel, band, className }: ChannelBadgeProps): JSX.Element {
  const inferredBand = band ?? (channel <= 14 ? "2.4" : channel <= 177 ? "5" : "6");
  return (
    <Badge tone="neutral" outline className={className}>
      <span className="font-mono">ch {channel}</span>
      <span className="text-fg-40">·</span>
      <span className="font-mono">{inferredBand}GHz</span>
    </Badge>
  );
}
