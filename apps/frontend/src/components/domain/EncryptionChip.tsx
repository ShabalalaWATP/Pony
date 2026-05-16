import { Lock, LockOpen, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";

interface EncryptionChipProps {
  /** Conventional values: WPA3, WPA2, WPA, WEP, OPEN. Other strings classify as Open. */
  encryption: string;
  className?: string;
}

function classify(enc: string): { label: string; tone: BadgeProps["tone"]; icon: JSX.Element } {
  const normalised = enc.toUpperCase();
  if (normalised.includes("WPA3"))
    return { label: "WPA3", tone: "green", icon: <Lock className="size-3" aria-hidden="true" /> };
  if (normalised.includes("WPA2"))
    return { label: "WPA2", tone: "cyan", icon: <Lock className="size-3" aria-hidden="true" /> };
  if (normalised.includes("WPA"))
    return { label: "WPA", tone: "amber", icon: <Lock className="size-3" aria-hidden="true" /> };
  if (normalised.includes("WEP"))
    return {
      label: "WEP",
      tone: "amber",
      icon: <LockOpen className="size-3" aria-hidden="true" />,
    };
  return { label: "Open", tone: "red", icon: <Unlock className="size-3" aria-hidden="true" /> };
}

/**
 * Network encryption indicator. Colour escalates as the protection weakens
 * (green WPA3 → red Open), and the lock-icon shape changes so the signal
 * isn't colour-only.
 */
export function EncryptionChip({ encryption, className }: EncryptionChipProps): JSX.Element {
  const { label, tone, icon } = classify(encryption);
  return (
    <Badge tone={tone} className={className}>
      {icon}
      <span>{label}</span>
    </Badge>
  );
}
