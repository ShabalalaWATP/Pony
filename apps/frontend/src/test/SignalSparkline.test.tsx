import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalSparkline } from "@/components/domain/SignalSparkline";

describe("SignalSparkline", () => {
  it("renders an SVG with a path for non-empty samples", () => {
    const { container } = render(<SignalSparkline samples={[-80, -70, -60, -50]} />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a dashed line for empty samples", () => {
    const { container } = render(<SignalSparkline samples={[]} />);
    expect(container.querySelector("line")).not.toBeNull();
    expect(container.querySelectorAll("path").length).toBe(0);
  });

  it("respects custom dimensions", () => {
    const { container } = render(<SignalSparkline samples={[-70, -60]} width={120} height={36} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("120");
    expect(svg?.getAttribute("height")).toBe("36");
  });
});
