import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnomalyBadge } from "@/components/domain/AnomalyBadge";

describe("AnomalyBadge", () => {
  it("renders the Clean tier at score 0", () => {
    render(<AnomalyBadge score={0} />);
    const el = screen.getByTestId("anomaly-badge");
    expect(el).toHaveAttribute("data-tier", "clean");
    expect(el).toHaveTextContent(/clean/i);
  });

  it("renders the Note tier at scores 1-30", () => {
    render(<AnomalyBadge score={15} />);
    expect(screen.getByTestId("anomaly-badge")).toHaveAttribute("data-tier", "note");
  });

  it("renders the Suspect tier at scores 31-60", () => {
    render(<AnomalyBadge score={45} />);
    expect(screen.getByTestId("anomaly-badge")).toHaveAttribute("data-tier", "suspect");
  });

  it("renders the Alert tier at scores ≥ 61", () => {
    render(<AnomalyBadge score={70} />);
    expect(screen.getByTestId("anomaly-badge")).toHaveAttribute("data-tier", "alert");
    render(<AnomalyBadge score={100} />);
    expect(screen.getAllByTestId("anomaly-badge")[1]).toHaveAttribute("data-tier", "alert");
  });

  it("surfaces the data-score attribute", () => {
    render(<AnomalyBadge score={42} />);
    expect(screen.getByTestId("anomaly-badge")).toHaveAttribute("data-score", "42");
  });

  it("hides the inline number when hideScore is set", () => {
    render(<AnomalyBadge score={42} hideScore />);
    const el = screen.getByTestId("anomaly-badge");
    expect(el).not.toHaveTextContent("42");
    expect(el).toHaveTextContent(/suspect/i);
  });
});
