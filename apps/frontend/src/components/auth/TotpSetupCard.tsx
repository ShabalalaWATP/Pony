import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, RotateCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { TotpInput } from "./TotpInput";
import { useSetup2FA, useVerify2FA, type UserPublic } from "@/services/auth/hooks";
import { cn } from "@/lib/cn";

interface TotpSetupCardProps {
  user: UserPublic;
}

/**
 * Two-step TOTP enrollment widget:
 *
 *   1. Click "Begin setup" → POST /auth/2fa/setup → backend returns the
 *      provisioning URI and the raw secret.
 *   2. Operator scans the QR (or types the secret) into their
 *      authenticator, types the 6-digit code, POST /auth/2fa/verify.
 *
 * On success the parent `useCurrentUser` cache is updated by
 * `useVerify2FA` so the user's `totp_enabled` flips.
 *
 * Re-enrolment: when `totp_enabled` is already true, the active-state
 * card surfaces a "Re-enrol" button. Clicking it kicks the same
 * `setup.mutate()` flow with a fresh secret — useful when the
 * operator loses their authenticator device or rotates secrets
 * pre-emptively. The verify step then overwrites the server-side
 * secret on success.
 */
export function TotpSetupCard({ user }: TotpSetupCardProps): JSX.Element {
  const setup = useSetup2FA();
  const verify = useVerify2FA();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string): Promise<void> => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures (e.g. insecure context)
    }
  };

  if (user.totp_enabled && !setup.data) {
    return (
      <div
        className="flex flex-wrap items-center gap-3 rounded-md border border-accent-green/40 bg-accent-green/10 px-4 py-3 text-sm text-accent-green"
        data-testid="totp-active-card"
      >
        <ShieldCheck className="size-4" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-medium">Two-factor authentication is enabled.</div>
          <div className="text-xs text-fg-80">
            Codes from your authenticator app will be required for privileged actions.
          </div>
        </div>
        <Badge tone="green" outline>
          Active
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setup.mutate()}
          disabled={setup.isPending}
          aria-label="Re-enrol two-factor authentication"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          {setup.isPending ? "Generating…" : "Re-enrol"}
        </Button>
        {setup.error && (
          <div role="alert" className="w-full text-xs text-accent-red">
            {setup.error.message}
          </div>
        )}
      </div>
    );
  }

  if (!setup.data) {
    return (
      <div className="rounded-md border border-fg-20 bg-bg-2 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-100">
          <ShieldCheck className="size-4 text-fg-60" aria-hidden="true" />
          Set up two-factor authentication
        </div>
        <p className="mb-4 text-xs text-fg-60">
          Required to use admin, audit, sensor management, and any active-module surface. Generates
          a TOTP secret you scan into an authenticator app.
        </p>
        <Button variant="primary" onClick={() => setup.mutate()} disabled={setup.isPending}>
          {setup.isPending ? "Generating…" : "Begin setup"}
        </Button>
        {setup.error && (
          <div role="alert" className="mt-3 text-xs text-accent-red">
            {setup.error.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-fg-20 bg-bg-2 p-5">
      <div className="mb-4 text-sm font-medium text-fg-100">Scan or paste the secret</div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center justify-center rounded-sm bg-fg-100 p-3">
          <QRCodeSVG value={setup.data.provisioning_uri} size={160} aria-label="TOTP QR code" />
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-2xs uppercase tracking-wide text-fg-60">Secret</div>
            <button
              type="button"
              onClick={() => void handleCopy(setup.data.secret)}
              className={cn(
                "mt-1 inline-flex items-center gap-2 rounded-sm border border-fg-20 bg-bg-1 px-2 py-1",
                "font-mono text-xs text-fg-100 hover:bg-bg-3",
              )}
            >
              <span className="select-all break-all">{setup.data.secret}</span>
              {copied ? (
                <Check className="size-3 text-accent-green" aria-hidden="true" />
              ) : (
                <Copy className="size-3 text-fg-40" aria-hidden="true" />
              )}
            </button>
          </div>
          <Separator />
          <div>
            <div className="text-2xs uppercase tracking-wide text-fg-60">
              Enter a 6-digit code from your authenticator
            </div>
            <div className="mt-2">
              <TotpInput
                disabled={verify.isPending}
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
                Verified — two-factor authentication is now active.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
