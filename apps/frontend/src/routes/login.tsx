import { Navigate, createFileRoute } from "@tanstack/react-router";
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
        {/*
          The brand mark is a lockup that already contains the
          "Cheeky // Pony" wordmark, so we don't render the separate
          <Wordmark> component here. The live-pulse `//` indicator
          stays in the sidebar where it has a live data feed to react
          to — on the static login screen it'd be pulsing against
          nothing.
        */}
        <img
          src="/logo-256.png"
          srcSet="/logo-192.png 192w, /logo-256.png 256w, /logo-512.png 512w"
          sizes="160px"
          alt="Cheeky Pony"
          width={160}
          height={160}
          className="size-40 select-none"
          draggable={false}
        />
        <div className="w-full text-left">
          <LoginForm defaultNext="/" />
        </div>
        <p className="font-mono text-2xs text-fg-40">cheeky-pony · v0.3.0</p>
      </div>
    </div>
  );
}
