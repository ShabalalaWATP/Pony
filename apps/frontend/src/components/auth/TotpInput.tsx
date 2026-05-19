import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface TotpInputProps {
  /** Number of digits — the backend accepts 6–8. Default 6. */
  length?: 6 | 7 | 8;
  /** Called every time the joined value changes. */
  onChange?: (value: string) => void;
  /** Called when the user has typed the full code. */
  onComplete?: (value: string) => void;
  /** Auto-focus the first cell on mount. */
  autoFocus?: boolean;
  /** Disable all cells. */
  disabled?: boolean;
  /** Visually indicate an error (red border, red focus glow). */
  invalid?: boolean;
  /** Accessible label applied to the cell group. */
  label?: string;
  className?: string;
}

/**
 * 6/7/8-cell TOTP entry control used by the login flow and `/settings/
 * account` TOTP enrollment.
 *
 * - Each cell holds a single digit (non-digits silently rejected).
 * - Typing auto-advances; backspace on an empty cell jumps to the
 *   previous cell and clears it.
 * - Arrow keys move between cells; paste of a full code fills every
 *   cell at once.
 * - `onComplete` fires the moment every cell has a digit — the
 *   authenticator-app paste case is the common path.
 *
 * Designed for keyboard-first operation per design spec §10 / §11.
 */
export function TotpInput({
  length = 6,
  onChange,
  onComplete,
  autoFocus = true,
  disabled = false,
  invalid = false,
  label = "Authentication code",
  className,
}: TotpInputProps): JSX.Element {
  const baseId = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(() => Array<string>(length).fill(""));

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const fire = useCallback(
    (next: string[]) => {
      const joined = next.join("");
      onChange?.(joined);
      if (joined.length === length && next.every((d) => d !== "")) {
        onComplete?.(joined);
      }
    },
    [length, onChange, onComplete],
  );

  const setAt = (index: number, value: string): void => {
    setDigits((prev) => {
      const next = prev.slice();
      next[index] = value;
      fire(next);
      return next;
    });
  };

  const handleChange = (index: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw.length <= 1) {
      setAt(index, raw);
      if (raw && index < length - 1) refs.current[index + 1]?.focus();
    } else {
      // Many browsers fire a `change` event on paste — handle multi-char inserts here too.
      handlePaste(index, raw);
    }
  };

  const handlePaste = (startIndex: number, raw: string): void => {
    const cleaned = raw.replace(/\D/g, "").slice(0, length - startIndex);
    if (!cleaned) return;
    setDigits((prev) => {
      const next = prev.slice();
      for (let i = 0; i < cleaned.length; i += 1) {
        next[startIndex + i] = cleaned[i] ?? "";
      }
      fire(next);
      return next;
    });
    const focusTarget = Math.min(startIndex + cleaned.length, length - 1);
    refs.current[focusTarget]?.focus();
  };

  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        setAt(index, "");
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        setAt(index - 1, "");
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  const handleClipboardPaste = (index: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    handlePaste(index, text);
  };

  return (
    <fieldset
      className={cn("flex items-center gap-2", className)}
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          id={`${baseId}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digits[i] ?? ""}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handleClipboardPaste(i)}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "h-11 w-10 rounded-sm border bg-bg-1 text-center font-mono text-md text-fg-100",
            "tabular-nums focus:outline-none focus-visible:border-mode",
            invalid ? "border-accent-red" : "border-fg-20",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        />
      ))}
    </fieldset>
  );
}
