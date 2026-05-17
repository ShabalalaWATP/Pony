import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLogin, useVerify2FA } from "@/services/auth/hooks";
import { cn } from "@/lib/cn";
import { sanitizeInternalPath } from "@/lib/safe-url";
import { TotpInput } from "./TotpInput";

type Phase = "credentials" | "totp";

interface LoginFormProps {
  /** Default redirect destination after a successful login. */
  defaultNext?: string;
}

export function LoginForm({ defaultNext = "/" }: LoginFormProps): JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  // `next` is operator-supplied via the `?next=` search param so it
  // has to be sanitized before we hand it to `router.navigate`. An
  // unsafe value (off-origin, `javascript:`, …) falls back to
  // `defaultNext` so a successful login still lands on a real page.
  const next = sanitizeInternalPath(search.next, defaultNext);

  const [phase, setPhase] = useState<Phase>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useLogin();
  const verify = useVerify2FA();

  const onCredentialsSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const resp = await login.mutateAsync({ email, password });
      if (resp.user.totp_enabled) {
        setPhase("totp");
      } else {
        await navigate({ to: next });
      }
    } catch {
      // Error rendered below via login.error
    }
  };

  const onTotpComplete = async (code: string): Promise<void> => {
    try {
      await verify.mutateAsync(code);
      await navigate({ to: next });
    } catch {
      // Error rendered below via verify.error
    }
  };

  const error = phase === "credentials" ? login.error?.message : verify.error?.message;

  return (
    <form
      onSubmit={(e) => {
        if (phase === "credentials") void onCredentialsSubmit(e);
        else e.preventDefault();
      }}
      className="flex w-full flex-col gap-4"
      aria-label="Sign in"
    >
      {phase === "credentials" ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-2xs uppercase tracking-wide text-fg-60">Email</span>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={login.isPending}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-2xs uppercase tracking-wide text-fg-60">Password</span>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={login.isPending}
            />
          </label>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-80">Enter the 6-digit code from your authenticator.</p>
          <TotpInput
            invalid={Boolean(verify.error)}
            disabled={verify.isPending}
            onComplete={(code) => void onTotpComplete(code)}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2",
            "text-xs text-accent-red",
          )}
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {phase === "credentials" && (
        <Button type="submit" variant="primary" disabled={login.isPending || !email || !password}>
          {login.isPending ? "Signing in…" : "Continue"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}
