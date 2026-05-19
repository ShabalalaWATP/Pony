import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose Tailwind class names safely.
 *
 * `clsx` handles conditional segments, `twMerge` resolves Tailwind conflicts
 * so caller-supplied utilities win over component defaults. This is the only
 * blessed way to combine class strings in the codebase.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
