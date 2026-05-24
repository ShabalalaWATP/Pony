import { Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

interface MacAddressProps {
  /** The MAC or BSSID (colon-separated, hex octets). */
  value: string;
  /**
   * OUI vendor name, shown inline next to the address (small + muted)
   * AND in the hover tooltip. Pass the backend's `vendor_resolved`
   * preferentially via `resolveVendor(item)` from `lib/vendor.ts`.
   */
  vendor?: string | null;
  className?: string;
  /** Render a shorter form (`a4:c3…:0a`) — useful in dense tables. */
  truncate?: boolean;
  /**
   * Suppress the inline vendor label even when `vendor` is supplied.
   * Use when the surrounding layout already has a dedicated vendor
   * column or chip and the duplication would be noisy.
   */
  hideInlineVendor?: boolean;
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
  hideInlineVendor = false,
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
  const showInlineVendor = Boolean(vendor) && !hideInlineVendor;

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
        {showInlineVendor && (
          <span
            data-testid="mac-vendor"
            className="font-sans text-2xs text-fg-60 normal-case tracking-normal"
          >
            · {vendor}
          </span>
        )}
        <Copy
          aria-hidden="true"
          className="size-3 text-fg-40 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    </Tooltip>
  );
}
