import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/ui/PageHeader";

describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Sensors" />);
    expect(screen.getByRole("heading", { name: "Sensors" })).toBeInTheDocument();
  });

  it("renders a formatted total when supplied", () => {
    render(<PageHeader title="Devices" total={1482} />);
    expect(screen.getByText(/n=1,482/)).toBeInTheDocument();
  });

  it("renders a search input and forwards changes", async () => {
    const onChange = vi.fn();
    render(
      <PageHeader
        title="Devices"
        search={{ value: "", onChange, placeholder: "Search devices…" }}
      />,
    );
    const input = screen.getByPlaceholderText("Search devices…");
    await userEvent.type(input, "abc");
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith("c");
  });
});
