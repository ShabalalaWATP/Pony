import { Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

interface MacAddressProps {
  /** The MAC or BSSID (colon-separated, hex octets). */
  value: string;
  /** OUI vendor name to show in the tooltip and copy-flash. */
  vendor?: string | null;
  className?: string;
  /** Render a shorter form (`a4:c3…:0a`) — useful in dense tables. */
  truncate?: boolean;
}

function shorten(mac: string): string {
  const parts = mac.split(":");
  if (parts.length < 6) return mac;
  return `${parts.slice(0, 2).join(":")}…${parts.slice(-2).join(":")}`;
}

/**
 * MAC / BSSID renderer with click-to-copy and an optional vendor tooltip.
 *
 * Every identifier in the UI should use this component (or its sibling
 * `Bssid`) — never bare strings — so behaviour stays consistent.
 */
export function MacAddress({
  value,
  vendor,
  className,
  truncate = false,
}: MacAddressProps): JSX.Element {
  const [flashed, setFlashed] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setFlashed(true);
      window.setTimeout(() => setFlashed(false), 220);
    } catch {
      // Clipboard refused (permission, insecure context) — fall through silently.
    }
  }, [value]);

  const tooltipBody = vendor ? `${value} · ${vendor}` : value;

  return (
    <Tooltip content={tooltipBody}>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-xs px-0.5 font-mono text-xs",
          "text-fg-100 hover:bg-bg-2 focus-visible:outline-none",
          flashed && "text-accent-cyan",
          className,
        )}
        aria-label={`Copy ${value}`}
      >
        <span className="tabular-nums">{truncate ? shorten(value) : value}</span>
        <Copy
          aria-hidden="true"
          className="size-3 text-fg-40 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    </Tooltip>
  );
}
