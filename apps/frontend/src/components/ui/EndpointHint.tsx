import { cn } from "@/lib/cn";

interface EndpointHintProps {
  /** The path or method+path to render, e.g. `/api/v1/users` or `GET /sensors`. */
  children: string;
  /** Optional extra classes for layout (margin, alignment). */
  className?: string;
}

/**
 * Small mono caption pointing at the backend endpoint a view talks to.
 * Used in page-header / drawer-header trims to remind operators (and
 * support engineers reading screenshots) which route is on the wire.
 *
 * Intentionally not a link or copy button — that's a different
 * affordance and adds attack surface.
 */
export function EndpointHint({ children, className }: EndpointHintProps): JSX.Element {
  return (
    <span
      className={cn(
        "font-mono text-2xs tracking-wide text-fg-40 select-text",
        "before:mr-1 before:text-fg-20 before:content-['→']",
        className,
      )}
      data-testid="endpoint-hint"
    >
      {children}
    </span>
  );
}
