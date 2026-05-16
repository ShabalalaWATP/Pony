import { useEffect, useRef } from "react";

type Handler = (event: KeyboardEvent) => void;

interface UseHotkeyOptions {
  /** Skip the binding when the active element is an editable input. */
  ignoreInputs?: boolean;
  /** Disable without unmounting. */
  enabled?: boolean;
}

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (INPUT_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

function matchesModifiers(event: KeyboardEvent, spec: string): boolean {
  // spec uses "mod+" for Ctrl on Win/Linux + Cmd on macOS.
  const want = spec
    .toLowerCase()
    .split("+")
    .map((p) => p.trim());
  const mods = {
    mod: event.ctrlKey || event.metaKey,
    ctrl: event.ctrlKey,
    cmd: event.metaKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  } as const;
  const key = want.pop();
  if (!key) return false;
  for (const m of want) {
    if (!(m in mods)) return false;
    if (!mods[m as keyof typeof mods]) return false;
  }
  return event.key.toLowerCase() === key;
}

/**
 * Bind a single hotkey ("mod+k", "/", "?", "[", "]") to a handler.
 *
 * For multi-key sequences (e.g. "g s") use `useHotkeySequence`.
 */
export function useHotkey(spec: string, handler: Handler, options: UseHotkeyOptions = {}): void {
  const { ignoreInputs = true, enabled = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent): void => {
      if (ignoreInputs && isEditable(event.target)) return;
      if (!matchesModifiers(event, spec)) return;
      handlerRef.current(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [spec, ignoreInputs, enabled]);
}

interface UseHotkeySequenceOptions extends UseHotkeyOptions {
  /** How long the user has to press the second key, in ms. */
  windowMs?: number;
}

/**
 * Bind a two-key sequence ("g s", "g n", "g d", …) to a handler.
 * The window between the two keypresses defaults to 1500ms.
 */
export function useHotkeySequence(
  sequence: string,
  handler: Handler,
  options: UseHotkeySequenceOptions = {},
): void {
  const { ignoreInputs = true, enabled = true, windowMs = 1500 } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const stateRef = useRef<{ awaitingSecond: boolean; timer: number | null }>({
    awaitingSecond: false,
    timer: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const keys = sequence.toLowerCase().split(/\s+/);
    if (keys.length !== 2) {
      throw new Error(`useHotkeySequence expects a two-key spec, got "${sequence}"`);
    }
    const [first, second] = keys;

    const listener = (event: KeyboardEvent): void => {
      if (ignoreInputs && isEditable(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      const state = stateRef.current;

      if (state.awaitingSecond) {
        if (key === second) {
          event.preventDefault();
          handlerRef.current(event);
        }
        state.awaitingSecond = false;
        if (state.timer != null) {
          window.clearTimeout(state.timer);
          state.timer = null;
        }
        return;
      }

      if (key === first) {
        state.awaitingSecond = true;
        state.timer = window.setTimeout(() => {
          state.awaitingSecond = false;
          state.timer = null;
        }, windowMs);
      }
    };

    window.addEventListener("keydown", listener);
    const state = stateRef.current;
    return () => {
      window.removeEventListener("keydown", listener);
      if (state.timer != null) {
        window.clearTimeout(state.timer);
      }
    };
  }, [sequence, ignoreInputs, enabled, windowMs]);
}
