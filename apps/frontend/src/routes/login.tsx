import { Navigate, createFileRoute } from "@tanstack/react-router";
import { Glyph } from "@/components/branding/Glyph";
import { Wordmark } from "@/components/branding/Wordmark";
import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeInternalPath } from "@/lib/safe-url";
import { useCurrentUser } from "@/services/auth/hooks";

interface LoginSearch {
  next?: string;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginRoute,
});

function LoginRoute(): JSX.Element {
  const { data, isLoading } = useCurrentUser();
  const { next } = Route.useSearch();

  // Already signed in — bounce to next/overview. The redirect target
  // comes from the `?next=` search param so it MUST be sanitized
  // before we hand it to router.navigate; otherwise an attacker who
  // gets a victim to click `/login?next=https://evil.example` would
  // bounce them off-origin after the auto-redirect.
  if (!isLoading && data) {
    return <Navigate to={sanitizeInternalPath(next, "/")} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-0 px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-md border border-fg-20 bg-bg-2 p-8 text-center">
        <Glyph className="size-12 text-mode" />
        <Wordmark forceState="live" />
        <div className="w-full text-left">
          <LoginForm defaultNext="/" />
        </div>
        <p className="font-mono text-2xs text-fg-40">cheeky-pony · v0.3.0</p>
      </div>
    </div>
  );
}
