import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalBars } from "@/components/domain/SignalBars";

describe("SignalBars", () => {
  it("renders the dBm value when showValue is true (default)", () => {
    render(<SignalBars dbm={-60} />);
    expect(screen.getByText("-60 dBm")).toBeInTheDocument();
  });

  it("hides the value when showValue is false", () => {
    render(<SignalBars dbm={-60} showValue={false} />);
    expect(screen.queryByText("-60 dBm")).toBeNull();
  });

  it("exposes the signal qualitatively via aria-label", () => {
    render(<SignalBars dbm={-48} />);
    expect(screen.getByLabelText(/excellent/i)).toBeInTheDocument();
  });

  it.each([
    [-40, "excellent"],
    [-60, "good"],
    [-70, "fair"],
    [-80, "weak"],
    [-95, "very weak"],
  ])("classifies %i dBm as %s", (dbm, label) => {
    render(<SignalBars dbm={dbm} showValue={false} />);
    expect(screen.getByLabelText(new RegExp(label, "i"))).toBeInTheDocument();
  });
});
