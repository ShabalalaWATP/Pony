import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabelBadge } from "@/components/domain/LabelBadge";

describe("LabelBadge", () => {
  it("renders a colour-coded badge for a meaningful AP label", () => {
    render(<LabelBadge kind="ap" label="corporate" confidence={0.9} />);
    const el = screen.getByTestId("label-badge-ap");
    expect(el).toHaveTextContent(/corporate/i);
    expect(el).toHaveAttribute("data-label", "corporate");
    expect(el).not.toHaveClass("opacity-60");
  });

  it("renders a meaningful device label", () => {
    render(<LabelBadge kind="device" label="mobile" confidence={0.85} />);
    expect(screen.getByTestId("label-badge-device")).toHaveTextContent(/mobile/i);
  });

  it("dims the badge when confidence < 0.8", () => {
    render(<LabelBadge kind="ap" label="iot" confidence={0.55} />);
    expect(screen.getByTestId("label-badge-ap")).toHaveClass("opacity-60");
  });

  it("renders nothing for `unknown`", () => {
    const { container } = render(<LabelBadge kind="ap" label="unknown" confidence={0.4} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for null / undefined label", () => {
    const { container, rerender } = render(<LabelBadge kind="ap" label={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LabelBadge kind="device" label={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("treats missing confidence as not-dim", () => {
    render(<LabelBadge kind="device" label="laptop" />);
    expect(screen.getByTestId("label-badge-device")).not.toHaveClass("opacity-60");
  });
});
