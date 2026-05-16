import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render the value in the monospace font (use for IDs, MACs, etc.). */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono = false, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-sm border border-fg-20 bg-bg-1 px-3 py-1 text-sm",
          "placeholder:text-fg-40",
          "focus-visible:outline-none focus-visible:border-fg-40",
          "disabled:cursor-not-allowed disabled:opacity-40",
          mono && "font-mono",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
