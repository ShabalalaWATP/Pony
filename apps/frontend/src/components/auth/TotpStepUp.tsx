import { Check, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { TotpInput } from "./TotpInput";
import { useVerify2FA } from "@/services/auth/hooks";

interface TotpStepUpProps {
  /**
   * Title shown on the prompt. Default reads "Recent verification
   * required" — overridable so admin surfaces can frame the reason
   * (e.g. "Re-verify to manage sensors").
   */
  title?: string;
  /**
   * Helper line under the title. Default reads "Enter your current
   * authenticator code to continue." — overridable so callers can
   * mention the destination action.
   */
  description?: string;
  /**
   * Fired once the backend verifies the entered code. The caller is
   * responsible for re-running whatever action triggered the prompt
   * (refetch a query, retry a mutation, etc.) — the step-up only
   * refreshes the recent-TOTP claim and updates the auth cache.
   */
  onSuccess: () => void;
  /**
   * Fired when the operator dismisses the prompt without verifying.
   * If omitted, no cancel button is rendered (use this for inline,
   * required step-ups that the user can't escape).
   */
  onCancel?: () => void;
  /** Optional `data-testid` on the wrapper for integration tests. */
  testId?: string;
}

/**
 * Reusable TOTP step-up prompt.
 *
 * Surfaces after any admin-gated call returns
 * `403 {"detail": "totp_required"}` (use `isTotpRequired(err)` to
 * detect). The operator's recent-TOTP claim has gone stale; this prompt
 * collects a current code, calls `POST /api/v1/auth/2fa/verify`, and
 * fires `onSuccess` so the caller can retry the original action.
 *
 * Designed to be embedded inline (Account/Security re-enrol) or as the
 * primary content of a 403 view (Sensors, Audit, Users, Alert rules,
 * Lab). The copy distinguishes "2FA is enabled" from "Recent
 * verification required" so operators don't think they need to log
 * out and back in.
 */
export function TotpStepUp({
  title = "Recent verification required",
  description = "Enter your current authenticator code to continue.",
  onSuccess,
  onCancel,
  testId,
}: TotpStepUpProps): JSX.Element {
  const verify = useVerify2FA();

  // Always call the latest `onSuccess` reference without forcing the
  // caller to wrap it in `useCallback`. We hold the latest callback in
  // a ref and only depend on `verify.isSuccess` in the effect so the
  // callback fires exactly once per successful verify, not on every
  // parent re-render.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  useEffect(() => {
    if (verify.isSuccess) onSuccessRef.current();
  }, [verify.isSuccess]);

  return (
    <div
      className="rounded-md border border-accent-amber/40 bg-accent-amber/10 p-4"
      data-testid={testId ?? "totp-step-up"}
      role="region"
      aria-label="Two-factor step-up"
    >
      <div className="mb-3 flex items-start gap-2">
        <ShieldAlert className="size-4 shrink-0 text-accent-amber" aria-hidden="true" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg-100">{title}</div>
          <div className="mt-0.5 text-xs text-fg-60">{description}</div>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel two-factor step-up"
            className="text-fg-40 hover:text-fg-80"
            disabled={verify.isPending}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-3">
        <TotpInput
          disabled={verify.isPending || verify.isSuccess}
          invalid={Boolean(verify.error)}
          onComplete={(code) => verify.mutate(code)}
        />
      </div>

      {verify.error && (
        <div role="alert" className="mt-2 text-xs text-accent-red">
          {verify.error.message}
        </div>
      )}
      {verify.isSuccess && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-accent-green">
          <Check className="size-3" aria-hidden="true" />
          Verified — continuing…
        </div>
      )}

      {onCancel && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={verify.isPending}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
