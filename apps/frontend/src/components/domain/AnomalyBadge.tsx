import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import type { components } from "@/services/api/openapi";

type AnomalyContribution = components["schemas"]["AnomalyContribution"];

interface AnomalyBadgeProps {
  /**
   * Server-derived 0-100 anomaly score from
   * `cheeky_pony_backend.domain.anomaly` (PR #59). Backend already
   * clamps to [0, 100] so the frontend just needs to render the
   * tier. Tiers (from the backend ADR):
   *   - 0       → clean (rendered as a quiet "clean" chip)
   *   - 1-30    → note   (neutral chip, "watch")
   *   - 31-60   → suspect (amber chip)
   *   - 61-100  → alert  (red chip)
   */
  score: number;
  /**
   * Per-reason breakdown. Surfaced in the hover tooltip so the
   * operator can see WHY the score is non-zero without leaving the
   * list view.
   */
  reasons?: AnomalyContribution[];
  /** Hides the score number; useful in extra-tight cells. */
  hideScore?: boolean;
}

interface Tier {
  tone: "neutral" | "amber" | "red" | "green";
  label: string;
  Icon: typeof ShieldCheck;
}

function tierFor(score: number): Tier {
  if (score >= 61) return { tone: "red", label: "Alert", Icon: ShieldAlert };
  if (score >= 31) return { tone: "amber", label: "Suspect", Icon: AlertTriangle };
  if (score >= 1) return { tone: "neutral", label: "Note", Icon: AlertTriangle };
  return { tone: "green", label: "Clean", Icon: ShieldCheck };
}

/**
 * AP anomaly score chip. Backend computes the score + per-reason
 * contributions; the frontend picks a tier and renders the chip.
 * Reasons surface in the tooltip rather than the chip itself so dense
 * tables stay scannable.
 *
 * `clean` (score=0) renders a quiet green chip — the operator's
 * default eyes-on signal that nothing looks suspicious. To hide
 * clean rows entirely, surrounding views can filter on `score > 0`.
 */
export function AnomalyBadge({ score, reasons, hideScore }: AnomalyBadgeProps): JSX.Element {
  const { tone, label, Icon } = tierFor(score);
  const reasonLines =
    reasons && reasons.length > 0
      ? reasons.map((r) => `${r.detail} (${r.weight})`).join("\n")
      : "No contributing reasons.";
  const tooltipBody = `${label} · score ${score}\n${reasonLines}`;
  return (
    <Tooltip content={tooltipBody}>
      <Badge
        tone={tone}
        outline
        data-testid="anomaly-badge"
        data-tier={label.toLowerCase()}
        data-score={score}
        className="cursor-default"
      >
        <Icon className="size-3" aria-hidden="true" />
        {!hideScore && <span className="tabular-nums">{score}</span>}
        <span>{label}</span>
      </Badge>
    </Tooltip>
  );
}
