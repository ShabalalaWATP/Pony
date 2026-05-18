import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacAddress } from "@/components/domain/MacAddress";

describe("MacAddress", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the full address by default", () => {
    render(<MacAddress value="a4:c3:f0:1d:88:0a" />);
    expect(screen.getByText("a4:c3:f0:1d:88:0a")).toBeInTheDocument();
  });

  it("truncates when requested", () => {
    render(<MacAddress value="a4:c3:f0:1d:88:0a" truncate />);
    expect(screen.getByText(/a4:c3…88:0a/)).toBeInTheDocument();
  });

  it("copies to clipboard when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<MacAddress value="a4:c3:f0:1d:88:0a" />);
    await userEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("a4:c3:f0:1d:88:0a");
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 250);
      });
    });
  });

  it("falls back silently when clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    render(<MacAddress value="a4:c3:f0:1d:88:0a" />);
    // Should not throw on click
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("a4:c3:f0:1d:88:0a")).toBeInTheDocument();
  });
});
