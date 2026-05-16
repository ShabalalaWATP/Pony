import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium",
    "transition-colors duration-base ease-[var(--ease-out-expo)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-mode text-bg-0 hover:brightness-110 active:brightness-95",
        secondary: "border border-fg-20 bg-bg-2 text-fg-100 hover:bg-bg-3 hover:border-fg-40",
        ghost: "bg-transparent text-fg-80 hover:bg-bg-2 hover:text-fg-100",
        danger: "bg-accent-red text-bg-0 hover:brightness-110 active:brightness-95",
        link: "text-mode hover:underline underline-offset-2 px-0",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-3.5 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components -- variant helper used by other UI primitives
export { buttonVariants };
