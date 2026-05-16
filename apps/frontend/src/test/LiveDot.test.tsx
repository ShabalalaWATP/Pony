import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveDot } from "@/components/domain/LiveDot";

describe("LiveDot", () => {
  it("renders the default state label", () => {
    render(<LiveDot state="live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<LiveDot state="stale" label="5m delayed" />);
    expect(screen.getByText("5m delayed")).toBeInTheDocument();
  });

  it("renders stale and offline states with their labels", () => {
    const { rerender } = render(<LiveDot state="stale" />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    rerender(<LiveDot state="offline" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });
});
