import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide",
  {
    variants: {
      tone: {
        neutral: "bg-bg-3 text-fg-80",
        accent: "bg-mode/15 text-mode",
        cyan: "bg-accent-cyan/15 text-accent-cyan",
        violet: "bg-accent-violet/15 text-accent-violet",
        amber: "bg-accent-amber/15 text-accent-amber",
        green: "bg-accent-green/15 text-accent-green",
        red: "bg-accent-red/15 text-accent-red",
      },
      outline: {
        true: "bg-transparent border",
        false: "",
      },
    },
    compoundVariants: [
      { tone: "neutral", outline: true, class: "border-fg-20 text-fg-80" },
      { tone: "accent", outline: true, class: "border-mode/40 text-mode" },
      { tone: "cyan", outline: true, class: "border-accent-cyan/40" },
      { tone: "violet", outline: true, class: "border-accent-violet/40" },
      { tone: "amber", outline: true, class: "border-accent-amber/40" },
      { tone: "green", outline: true, class: "border-accent-green/40" },
      { tone: "red", outline: true, class: "border-accent-red/40" },
    ],
    defaultVariants: {
      tone: "neutral",
      outline: false,
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, outline, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ tone, outline }), className)} {...props} />;
}
