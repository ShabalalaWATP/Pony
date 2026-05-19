import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, UserCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { useCurrentUser, useLogout, type UserPublic } from "@/services/auth/hooks";
import { cn } from "@/lib/cn";

interface UserMenuProps {
  user: UserPublic;
}

/**
 * Concrete dropdown implementation. Split from `UserMenu` so the
 * unauthenticated case can short-circuit to `null` without paying
 * the cost of the menu's own state hooks.
 */
function UserMenuInner({ user }: UserMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const logout = useLogout();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const role = user.roles && user.roles.length > 0 ? user.roles[0] : "operator";

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open user menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserCircle2 className="size-4" aria-hidden="true" />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-md border border-fg-20",
            "bg-bg-3 shadow-2xl shadow-black/40",
          )}
        >
          <div className="px-3 py-2.5">
            <div className="truncate text-sm text-fg-100">{user.email}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs uppercase tracking-wide text-fg-60">
              <span>{role}</span>
              <span className="text-fg-40">·</span>
              <span>{user.totp_enabled ? "2FA on" : "2FA off"}</span>
            </div>
          </div>
          <Separator />
          <Link
            to="/settings/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-fg-80 hover:bg-bg-2 hover:text-fg-100"
          >
            <Settings className="size-3.5" aria-hidden="true" />
            Account & security
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void (async (): Promise<void> => {
                await logout.mutateAsync();
                setOpen(false);
                await navigate({ to: "/login" });
              })();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-80 hover:bg-bg-2 hover:text-fg-100"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Topbar user widget. If the current-user query is still loading we render
 * nothing — `AuthGuard` covers the loading state at the shell level.
 */
export function UserMenu(): JSX.Element | null {
  const { data } = useCurrentUser();
  if (!data) return null;
  return <UserMenuInner user={data.user} />;
}
