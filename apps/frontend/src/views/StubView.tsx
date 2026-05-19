import { EmptyState } from "@/components/domain/EmptyState";
import { Badge } from "@/components/ui/Badge";

interface StubViewProps {
  /** Route title displayed at the top. */
  title: string;
  /** When this route's behaviour is filled in. */
  stage: 3 | 4 | 5 | 6 | 7 | 8;
  /** One-line description of what'll live here. */
  description: string;
}

/**
 * Placeholder view used by every stubbed Stage 2 route. Replace with the
 * real view in the stage indicated by `stage`.
 */
export function StubView({ title, stage, description }: StubViewProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg-100">{title}</h1>
        <Badge tone="accent" outline>{`Stage ${stage}`}</Badge>
      </header>
      <div className="rounded-md border border-fg-20 bg-bg-1 py-12">
        <EmptyState title={`${title} — coming in Stage ${stage}`} description={description} />
      </div>
    </div>
  );
}
