import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StubView } from "@/views/StubView";

describe("StubView", () => {
  it("renders title, stage badge, and description", () => {
    render(<StubView title="Networks" stage={5} description="Virtualised AP table." />);
    expect(screen.getByRole("heading", { name: "Networks" })).toBeInTheDocument();
    expect(screen.getByText("Stage 5")).toBeInTheDocument();
    expect(screen.getByText("Virtualised AP table.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Networks — coming in Stage 5" }),
    ).toBeInTheDocument();
  });
});
