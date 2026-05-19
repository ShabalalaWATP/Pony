import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Right-aligned chip(s) beside the title. */
  meta?: React.ReactNode;
  /** Sticky action bar at the bottom (e.g. "Export PCAP"). */
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}

/**
 * Right-edge slide-in drawer used for detail views. Operators get list
 * context preserved behind the overlay; URL state lives upstream (route
 * params or a `?drawer=` search param), so opening a drawer is
 * shareable.
 *
 * Closes on:
 * - clicking the backdrop
 * - clicking the close button
 * - pressing Escape
 *
 * Focus moves to the close button on open so keyboard users can
 * immediately dismiss it without tab cycling through the list behind.
 */
export function Drawer({
  open,
  onClose,
  title,
  meta,
  footer,
  width = 480,
  children,
}: DrawerProps): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Detail"}
      className="fixed inset-0 z-40 flex justify-end"
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className={cn(
          "absolute inset-0 cursor-default bg-bg-0/60 backdrop-blur-sm",
          "transition-opacity duration-base",
        )}
      />
      <aside
        className={cn(
          "relative flex h-screen flex-col border-l border-fg-20 bg-bg-2 shadow-2xl shadow-black/40",
          "duration-drawer animate-in slide-in-from-right",
        )}
        style={{ width }}
      >
        <header className="flex h-12 items-center gap-3 border-b border-fg-20 bg-bg-3 px-4">
          <div className="flex flex-1 items-center gap-3 truncate text-sm font-medium text-fg-100">
            {title}
          </div>
          {meta && <div className="flex items-center gap-2">{meta}</div>}
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="border-t border-fg-20 bg-bg-3 px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
