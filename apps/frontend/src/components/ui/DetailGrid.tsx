import type { ReactNode } from "react";

interface DetailSectionProps {
  label: string;
  /** Optional element rendered at the right edge of the section header (e.g. `EndpointHint`). */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Drawer / detail-card section: small uppercase caption above the
 * payload, with an optional trailing element at the right edge of the
 * header (typically an `EndpointHint`). Used inside every entity
 * detail drawer (Sensors, Networks, Devices, Account) for visual
 * consistency.
 */
export function DetailSection({ label, trailing, children }: DetailSectionProps): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs uppercase tracking-wide text-fg-60">{label}</h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

interface DetailRowProps {
  label: string;
  value: ReactNode;
}

/**
 * Label-value row inside a `DetailSection`. Fixed-width label gutter
 * keeps multiple rows aligned without ad-hoc CSS in every drawer.
 */
export function DetailRow({ label, value }: DetailRowProps): JSX.Element {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 text-sm">
      <div className="text-xs text-fg-60">{label}</div>
      <div className="text-fg-100">{value}</div>
    </div>
  );
}
