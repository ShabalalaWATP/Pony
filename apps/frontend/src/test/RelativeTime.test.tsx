import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { RelativeTime } from "@/components/domain/RelativeTime";

const FIXED_NOW = new Date("2026-05-16T14:00:00Z").getTime();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("RelativeTime", () => {
  it("formats seconds", () => {
    render(<RelativeTime value={FIXED_NOW - 12_000} />);
    expect(screen.getByText("12s ago")).toBeInTheDocument();
  });

  it("formats minutes", () => {
    render(<RelativeTime value={FIXED_NOW - 5 * 60_000} />);
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("formats hours", () => {
    render(<RelativeTime value={FIXED_NOW - 3 * 3_600_000} />);
    expect(screen.getByText("3h ago")).toBeInTheDocument();
  });

  it("formats days", () => {
    render(<RelativeTime value={FIXED_NOW - 2 * 86_400_000} />);
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });

  it("exposes the absolute timestamp in a datetime attribute", () => {
    render(<RelativeTime value={FIXED_NOW - 4_000} />);
    const el = screen.getByText("4s ago");
    expect(el.getAttribute("datetime")).toBe(new Date(FIXED_NOW - 4_000).toISOString());
  });
});
