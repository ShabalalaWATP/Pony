import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/services/auth/hooks";

interface AuthGuardProps {
  children: ReactNode;
}

function LoadingShell(): JSX.Element {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-bg-0"
      data-testid="auth-loading-shell"
    >
      {/*
        Brand mark while we resolve the silent refresh. Uses the
        small variant — at this size the wordmark below the pony
        head stays legible without forcing a 512px asset on every
        cold load.
      */}
      <img
        src="/logo-192.png"
        srcSet="/logo-192.png 192w, /logo-256.png 256w"
        sizes="96px"
        alt="Cheeky Pony"
        width={96}
        height={96}
        className="size-24 animate-pulse select-none"
        draggable={false}
      />
    </div>
  );
}

/**
 * Gate every authenticated route on the operator's session.
 *
 * On first render, `useCurrentUser` attempts a silent refresh. While the
 * request is in flight we show a centred glyph. On 401 we redirect to
 * `/login?next=<current-path>` via `useEffect` rather than a render-time
 * `<Navigate>` so the redirect can't induce a render loop if anything
 * (e.g. an HMR-triggered re-mount) leaves the cached query in a flicker
 * state.
 */
export function AuthGuard({ children }: AuthGuardProps): JSX.Element {
  const { data, isLoading } = useCurrentUser();
  const navigate = useNavigate();
  const { location } = useRouterState();

  useEffect(() => {
    if (isLoading || data) return;
    if (location.pathname === "/login") return;
    void navigate({
      to: "/login",
      search: { next: location.pathname + location.searchStr },
      replace: true,
    });
  }, [isLoading, data, location.pathname, location.searchStr, navigate]);

  if (isLoading || !data) return <LoadingShell />;
  return <>{children}</>;
}
