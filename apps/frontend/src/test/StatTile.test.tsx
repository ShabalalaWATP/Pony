import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "@/components/domain/StatTile";

describe("StatTile", () => {
  it("renders the label and value", () => {
    render(<StatTile label="Devices online" value="1 482" />);
    expect(screen.getByText("Devices online")).toBeInTheDocument();
    expect(screen.getByText("1 482")).toBeInTheDocument();
  });

  it("prefixes positive deltas with +", () => {
    render(<StatTile label="APs" value="42" delta={12} />);
    expect(screen.getByText("+12")).toBeInTheDocument();
  });

  it("renders negative deltas without prefix", () => {
    render(<StatTile label="Alerts" value="3" delta={-2} />);
    expect(screen.getByText("-2")).toBeInTheDocument();
  });

  it("renders a sparkline when trend is provided", () => {
    const { container } = render(<StatTile label="APs" value="42" trend={[-70, -65, -60, -55]} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
