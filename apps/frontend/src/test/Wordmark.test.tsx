import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "@/components/branding/Wordmark";

describe("Wordmark", () => {
  it("exposes the brand name as an accessible label", () => {
    render(<Wordmark />);
    expect(screen.getByLabelText("Cheeky Pony")).toBeInTheDocument();
  });

  it("renders the // separator", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toContain("//");
  });

  it("animates the separator in the live state", () => {
    const { container } = render(<Wordmark forceState="live" />);
    const separator = container.querySelector('[aria-hidden="true"]');
    expect(separator?.className).toMatch(/cp-live-pulse/);
  });

  it("does not animate in the stale state", () => {
    const { container } = render(<Wordmark forceState="stale" />);
    const separator = container.querySelector('[aria-hidden="true"]');
    expect(separator?.className).not.toMatch(/cp-live-pulse/);
  });
});
