import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Glyph } from "@/components/branding/Glyph";

describe("Glyph", () => {
  it("renders with the default accessible label", () => {
    render(<Glyph />);
    expect(screen.getByRole("img", { name: "Cheeky Pony" })).toBeInTheDocument();
  });

  it("is decorative when label is empty", () => {
    const { container } = render(<Glyph label="" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
  });

  it("drops the outer sweep arc in compact mode", () => {
    const { container, rerender } = render(<Glyph />);
    const fullPaths = container.querySelectorAll("path").length;
    rerender(<Glyph compact />);
    const compactPaths = container.querySelectorAll("path").length;
    expect(compactPaths).toBeLessThan(fullPaths);
  });
});
