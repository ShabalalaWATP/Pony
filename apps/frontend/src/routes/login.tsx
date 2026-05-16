import { createFileRoute } from "@tanstack/react-router";
import { Glyph } from "@/components/branding/Glyph";
import { Wordmark } from "@/components/branding/Wordmark";
import { Badge } from "@/components/ui/Badge";

export const Route = createFileRoute("/login")({
  component: LoginPlaceholder,
});

function LoginPlaceholder(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-0 px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-md border border-fg-20 bg-bg-2 p-8 text-center">
        <Glyph className="size-12 text-mode" />
        <Wordmark forceState="live" />
        <Badge tone="accent" outline>
          Stage 3
        </Badge>
        <p className="text-sm text-fg-60">
          Login + TOTP flow lands in Stage 3 — paired with the backend cookie/CSRF + 2FA contract.
        </p>
      </div>
    </div>
  );
}
