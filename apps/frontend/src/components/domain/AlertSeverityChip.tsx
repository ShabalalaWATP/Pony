import { AlertOctagon, AlertTriangle, Info, Siren, type LucideIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface AlertSeverityChipProps {
  severity: Severity;
  className?: string;
}

const MAP: Record<Severity, { label: string; tone: BadgeProps["tone"]; Icon: LucideIcon }> = {
  critical: { label: "Critical", tone: "red", Icon: Siren },
  high: { label: "High", tone: "red", Icon: AlertOctagon },
  medium: { label: "Medium", tone: "amber", Icon: AlertTriangle },
  low: { label: "Low", tone: "cyan", Icon: AlertTriangle },
  info: { label: "Info", tone: "neutral", Icon: Info },
};

export function AlertSeverityChip({ severity, className }: AlertSeverityChipProps): JSX.Element {
  const { label, tone, Icon } = MAP[severity];
  return (
    <Badge tone={tone} className={className}>
      <Icon className="size-3" aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}
