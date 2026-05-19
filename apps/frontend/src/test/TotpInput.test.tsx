import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TotpInput } from "@/components/auth/TotpInput";

describe("TotpInput", () => {
  it("renders 6 cells by default", () => {
    render(<TotpInput autoFocus={false} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("accepts a custom length", () => {
    render(<TotpInput length={8} autoFocus={false} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(8);
  });

  it("auto-advances on digit input and fires onComplete", async () => {
    const onComplete = vi.fn();
    render(<TotpInput onComplete={onComplete} autoFocus={false} />);
    const cells = screen.getAllByRole("textbox");
    cells[0]!.focus();
    await userEvent.keyboard("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("ignores non-digit input", async () => {
    const onChange = vi.fn();
    render(<TotpInput onChange={onChange} autoFocus={false} />);
    const cells = screen.getAllByRole("textbox");
    cells[0]!.focus();
    await userEvent.keyboard("a");
    expect((cells[0] as HTMLInputElement).value).toBe("");
  });

  it("backspace on an empty cell jumps to the previous cell and clears it", async () => {
    render(<TotpInput autoFocus={false} />);
    const cells = screen.getAllByRole<HTMLInputElement>("textbox");
    cells[0]!.focus();
    await userEvent.keyboard("12");
    expect(cells[0]!.value).toBe("1");
    expect(cells[1]!.value).toBe("2");
    // Cursor is now on cell 2 (empty). Backspace should jump back and clear cell 1.
    await userEvent.keyboard("{Backspace}");
    expect(cells[1]!.value).toBe("");
    await userEvent.keyboard("{Backspace}");
    expect(cells[0]!.value).toBe("");
  });

  it("supports arrow-key navigation", async () => {
    render(<TotpInput autoFocus={false} />);
    const cells = screen.getAllByRole("textbox");
    cells[2]!.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(cells[1]);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(cells[3]);
  });

  it("fills all cells on paste", async () => {
    const onComplete = vi.fn();
    render(<TotpInput onComplete={onComplete} autoFocus={false} />);
    const cells = screen.getAllByRole<HTMLInputElement>("textbox");
    cells[0]!.focus();
    await userEvent.paste("654321");
    cells.forEach((cell, i) => {
      expect(cell.value).toBe("654321"[i]);
    });
    expect(onComplete).toHaveBeenCalledWith("654321");
  });

  it("supports a disabled state", () => {
    render(<TotpInput disabled autoFocus={false} />);
    for (const cell of screen.getAllByRole("textbox")) {
      expect(cell).toBeDisabled();
    }
  });

  it("marks the group invalid when requested", () => {
    const { container } = render(<TotpInput invalid autoFocus={false} />);
    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.getAttribute("aria-invalid")).toBe("true");
  });
});
