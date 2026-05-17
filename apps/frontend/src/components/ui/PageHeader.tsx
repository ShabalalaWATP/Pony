import { Input } from "./Input";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  title: string;
  total?: number;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  children?: React.ReactNode;
  className?: string;
}

/**
 * Top section of every list view: title + count + search + slot for
 * filter chips / actions.
 */
export function PageHeader({
  title,
  total,
  search,
  children,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn("flex flex-wrap items-center gap-3", className)}>
      <h1 className="font-display text-xl font-semibold tracking-tight text-fg-100">{title}</h1>
      {total !== undefined && (
        <span className="font-mono text-2xs text-fg-60">
          n={new Intl.NumberFormat("en-GB").format(total)}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {search && (
          <label className="relative inline-flex items-center">
            <Search className="absolute left-2 size-3.5 text-fg-40" aria-hidden="true" />
            <Input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search…"}
              className="h-8 w-56 pl-7 text-xs"
              aria-label="Search list"
            />
          </label>
        )}
        {children}
      </div>
    </header>
  );
}
