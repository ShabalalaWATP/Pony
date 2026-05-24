import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import {
  describeApLabel,
  describeDeviceLabel,
  isMeaningfulLabel,
  type ApType,
  type DeviceClass,
} from "@/lib/labels";

interface CommonProps {
  /** 0-1 — visually fades the badge below 0.8 to communicate uncertainty. */
  confidence?: number;
  className?: string;
}

type LabelBadgeProps =
  | (CommonProps & { kind: "ap"; label: ApType | null | undefined })
  | (CommonProps & { kind: "device"; label: DeviceClass | null | undefined });

/**
 * Server-derived label chip. Renders nothing for `unknown` /
 * `null` / `undefined` so list views don't get cluttered with
 * meaningless "Unknown" badges.
 *
 * The classification + confidence threshold both happen server-side
 * (`cheeky_pony_backend.domain.labelling`, PR #58). The frontend's
 * job is purely presentational: pick the right palette per label,
 * fade slightly when confidence sits below 0.8 to signal that the
 * classifier wasn't certain.
 */
export function LabelBadge(props: LabelBadgeProps): JSX.Element | null {
  const { label, confidence, className, kind } = props;
  if (!isMeaningfulLabel(label)) return null;
  // `isMeaningfulLabel` already narrowed: a meaningful label is
  // non-null and non-"unknown", but TS can't carry that narrowing
  // across the discriminated union. Re-narrow per-branch.
  const meta =
    kind === "ap" && label !== null && label !== undefined && label !== "unknown"
      ? describeApLabel(label)
      : kind === "device" && label !== null && label !== undefined && label !== "unknown"
        ? describeDeviceLabel(label)
        : null;
  if (!meta) return null;
  const dim = typeof confidence === "number" && confidence < 0.8;
  return (
    <Badge
      tone={meta.tone}
      data-testid={`label-badge-${kind}`}
      data-label={label}
      data-confidence={confidence ?? ""}
      className={cn(dim && "opacity-60", className)}
    >
      {meta.display}
    </Badge>
  );
}
