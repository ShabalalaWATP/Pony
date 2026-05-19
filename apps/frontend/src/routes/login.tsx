import { Navigate, createFileRoute } from "@tanstack/react-router";
import { LoginForm } from "@/components/auth/LoginForm";
import { LoginScene } from "@/components/auth/LoginScene";
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
    <LoginScene>
      <LoginForm defaultNext="/" />
    </LoginScene>
  );
}
