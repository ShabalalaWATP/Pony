import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHotkey, useHotkeySequence } from "@/hooks/useHotkey";

function press(
  key: string,
  opts: KeyboardEventInit = {},
  target: EventTarget | null = window,
): void {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  (target ?? window).dispatchEvent(ev);
}

describe("useHotkey", () => {
  let handler: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    handler = vi.fn();
  });

  it("fires for a single matching key", () => {
    renderHook(() => useHotkey("escape", handler));
    act(() => press("Escape"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("respects mod+ modifier (Ctrl or Cmd)", () => {
    renderHook(() => useHotkey("mod+k", handler));
    act(() => press("k"));
    expect(handler).not.toHaveBeenCalled();
    act(() => press("k", { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    act(() => press("k", { metaKey: true }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("ignores key presses inside editable elements by default", () => {
    renderHook(() => useHotkey("k", handler));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => press("k", {}, input));
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does not fire when disabled", () => {
    renderHook(() => useHotkey("k", handler, { enabled: false }));
    act(() => press("k"));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("useHotkeySequence", () => {
  let handler: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    handler = vi.fn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires when the two keys are pressed in order within the window", () => {
    renderHook(() => useHotkeySequence("g s", handler));
    act(() => press("g"));
    act(() => press("s"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("resets when the second key doesn't match", () => {
    renderHook(() => useHotkeySequence("g s", handler));
    act(() => press("g"));
    act(() => press("x"));
    act(() => press("s"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("expires the awaiting state after the window", () => {
    renderHook(() => useHotkeySequence("g s", handler, { windowMs: 1000 }));
    act(() => press("g"));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => press("s"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when modifier keys are held", () => {
    renderHook(() => useHotkeySequence("g s", handler));
    act(() => press("g", { ctrlKey: true }));
    act(() => press("s"));
    expect(handler).not.toHaveBeenCalled();
  });
});
