import { renderHook, act } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useLivePulse } from "@/hooks/useLivePulse";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const FIXED_NOW = new Date("2026-05-16T14:00:00Z").getTime();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("useLivePulse", () => {
  it("returns false when no timestamp is provided", () => {
    const { result } = renderHook(() => useLivePulse(null));
    expect(result.current).toBe(false);
  });

  it("returns true within the fresh window", () => {
    const { result } = renderHook(() => useLivePulse(FIXED_NOW - 2_000));
    expect(result.current).toBe(true);
  });

  it("flips to false once the fresh window passes", () => {
    const { result } = renderHook(() => useLivePulse(FIXED_NOW, 5_000));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current).toBe(false);
  });
});

describe("useReducedMotion", () => {
  it("defaults to false when matchMedia reports no preference", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
