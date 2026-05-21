import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, KeyRound, RotateCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { TotpInput } from "./TotpInput";
import { TotpStepUp } from "./TotpStepUp";
import {
  isTotpRequired,
  useSetup2FA,
  useVerify2FA,
  type UserPublic,
} from "@/services/auth/hooks";
import { cn } from "@/lib/cn";

interface TotpSetupCardProps {
  user: UserPublic;
}

/**
 * Active-card mode for the recent-TOTP step-up:
 *
 * - `idle`            — show the active card with "Re-verify" + "Re-enrol".
 * - `verify-only`     — user clicked "Re-verify". Render `TotpStepUp`;
 *                       on success, just confirm and return to idle.
 * - `reenrol-stepup`  — user clicked "Re-enrol" and the backend returned
 *                       `403 totp_required`. Render `TotpStepUp`; on
 *                       success, auto-retry `setup.mutate()` so the
 *                       operator lands on the QR view.
 */
type ActiveMode = "idle" | "verify-only" | "reenrol-stepup";

/**
 * Two-step TOTP enrollment widget plus recent-verification step-up.
 *
 *   1. Click "Begin setup" → POST /auth/2fa/setup → backend returns the
 *      provisioning URI and the raw secret.
 *   2. Operator scans the QR (or types the secret) into their
 *      authenticator, types the 6-digit code, POST /auth/2fa/verify.
 *
 * On success the parent `useCurrentUser` cache is updated by
 * `useVerify2FA` so the user's `totp_enabled` flips.
 *
 * Re-enrolment + re-verification (`totp_enabled === true`):
 *
 * - **Re-verify a recent code** — primary action when the operator
 *   landed here from another admin-gated view (Sensors, Audit, Users,
 *   Alert rules, Lab) that returned `403 totp_required`. Calls
 *   `/auth/2fa/verify` only; the secret is preserved. This is the
 *   lightweight path back from a stale recent-TOTP claim and avoids
 *   forcing the operator to log out / log in just to refresh the
 *   server-side `totp_verified_at` field.
 *
 * - **Re-enrol** — ghost action that rotates the TOTP secret. The
 *   backend gates this on recent verification, so a stale claim is
 *   handled by stepping up first: we surface the `TotpStepUp` prompt,
 *   call `/auth/2fa/verify` with the entered code, then retry
 *   `/auth/2fa/setup` once the claim is fresh. The QR view appears
 *   automatically on success.
 */
export function TotpSetupCard({ user }: TotpSetupCardProps): JSX.Element {
  const setup = useSetup2FA();
  const verify = useVerify2FA();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ActiveMode>("idle");

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

  const startReenrol = (): void => {
    setup.mutate(undefined, {
      onError: (err) => {
        if (isTotpRequired(err)) setMode("reenrol-stepup");
      },
    });
  };

  // Step-up success handler for the destructive Re-enrol path: the
  // backend has now accepted the verify, so the recent-TOTP claim is
  // fresh and the next `/auth/2fa/setup` call will succeed. Reset the
  // step-up state first, then kick the setup again so the parent
  // renders the QR view.
  const handleReenrolStepUpSuccess = (): void => {
    verify.reset();
    setMode("idle");
    setup.reset();
    setup.mutate();
  };

  // Verify-only success handler: keep the "Verified — continuing…"
  // banner visible briefly, then return to the idle active card. The
  // recent-TOTP claim is now fresh server-side; whoever sent the
  // operator here (e.g. Sensors 403) can navigate back and retry.
  const handleVerifyOnlySuccess = (): void => {
    window.setTimeout(() => {
      verify.reset();
      setMode("idle");
    }, 1200);
  };

  if (user.totp_enabled && !setup.data) {
    return (
      <div className="flex flex-col gap-3" data-testid="totp-active-card">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent-green/40 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">
          <ShieldCheck className="size-4" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-medium">Two-factor authentication is enabled.</div>
            <div className="text-xs text-fg-80">
              Codes from your authenticator app are required for privileged actions. The recent-
              verification window expires after a short interval — use{" "}
              <span className="font-medium">Re-verify</span> to refresh it without rotating your
              secret.
            </div>
          </div>
          <Badge tone="green" outline>
            Active
          </Badge>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setMode("verify-only")}
            disabled={mode !== "idle"}
            aria-label="Re-verify a recent two-factor code"
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            Re-verify
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={startReenrol}
            disabled={setup.isPending || mode !== "idle"}
            aria-label="Re-enrol two-factor authentication"
          >
            <RotateCw className="size-3.5" aria-hidden="true" />
            {setup.isPending ? "Generating…" : "Re-enrol"}
          </Button>
        </div>

        {mode === "verify-only" && (
          <TotpStepUp
            title="Re-verify a recent code"
            description="Type the current code from your authenticator app to refresh the recent-verification window. Your existing secret is preserved."
            onSuccess={handleVerifyOnlySuccess}
            onCancel={() => {
              verify.reset();
              setMode("idle");
            }}
            testId="totp-reverify"
          />
        )}

        {mode === "reenrol-stepup" && (
          <TotpStepUp
            title="Re-verify to rotate your secret"
            description="Type your current authenticator code first. After that, you'll see a fresh QR and secret to scan."
            onSuccess={handleReenrolStepUpSuccess}
            onCancel={() => {
              verify.reset();
              setup.reset();
              setMode("idle");
            }}
            testId="totp-reenrol-stepup"
          />
        )}

        {setup.error && !isTotpRequired(setup.error) && (
          <div role="alert" className="text-xs text-accent-red">
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
