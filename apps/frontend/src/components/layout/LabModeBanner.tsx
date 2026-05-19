import { AlertTriangle, Beaker } from "lucide-react";
import { useLabModeStore } from "@/stores/useLabModeStore";

/**
 * Slim banner that appears under the topbar whenever lab-mode preview
 * is on. Stage 7 will replace the preview check with a derived value
 * from backend acknowledgements + engagement scope.
 *
 * Operators must never be in doubt about whether they are in passive
 * or active mode — this banner is the secondary signal alongside the
 * topbar's violet underline + wordmark `//` colour shift.
 */
export function LabModeBanner(): JSX.Element | null {
  const preview = useLabModeStore((s) => s.preview);
  if (!preview) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-accent-violet/40 bg-accent-violet/10 px-4 py-1.5 text-xs text-accent-violet"
    >
      <Beaker className="size-3.5" aria-hidden="true" />
      <span className="font-medium uppercase tracking-wide">Lab Mode Preview</span>
      <AlertTriangle className="size-3.5" aria-hidden="true" />
      <span className="text-fg-80">
        Chrome shift is visual only — active modules are still gated by backend acknowledgement
        (Stage 7).
      </span>
    </div>
  );
}
