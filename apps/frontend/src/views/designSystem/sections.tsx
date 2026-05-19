import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * One labelled block of the design-system showcase. Title + optional
 * description above a bordered card holding the demo content.
 */
export function Section({ title, description, children }: SectionProps): JSX.Element {
  return (
    <section className="mb-16">
      <header className="mb-6">
        <h2 className="text-lg font-medium tracking-tight text-fg-100">{title}</h2>
        {description && <p className="mt-1 max-w-prose text-sm text-fg-60">{description}</p>}
      </header>
      <div className="rounded-lg border border-fg-20 bg-bg-1 p-6">{children}</div>
    </section>
  );
}

interface SwatchProps {
  name: string;
  varName: string;
}

/**
 * Single colour-token swatch: filled rectangle backed by the named CSS
 * custom property + a mono caption with the variable name.
 */
export function Swatch({ name, varName }: SwatchProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-sm border border-fg-20"
        style={{ background: `hsl(var(${varName}))` }}
      />
      <div className="flex flex-col gap-0.5">
        <code className="font-mono text-2xs text-fg-100">{name}</code>
        <code className="font-mono text-2xs text-fg-40">var({varName})</code>
      </div>
    </div>
  );
}
