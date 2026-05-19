import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "@/components/branding/Wordmark";

describe("Wordmark", () => {
  it("exposes the brand name as an accessible label", () => {
    render(<Wordmark />);
    expect(screen.getByLabelText("Cheeky Pony")).toBeInTheDocument();
  });

  it("renders both words of the brand mark", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toContain("cheeky");
    expect(container.textContent).toContain("pony");
  });

  it("does not render the legacy `//` separator", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).not.toContain("//");
  });
});
