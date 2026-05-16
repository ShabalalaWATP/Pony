import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystem } from "@/routes/DesignSystem";

describe("DesignSystem showcase", () => {
  it("renders all top-level section headings", () => {
    render(<DesignSystem />);
    for (const heading of [
      "Brand",
      "Surfaces",
      "Foreground",
      "Accents",
      "Type scale",
      "Buttons",
      "Inputs & filters",
      "Badges & severity",
      "Status & live data",
      "Network primitives",
      "KPI tiles",
      "States",
      "Tooltips & keys",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("toggles the lab-mode data attribute on the document root", async () => {
    render(<DesignSystem />);
    expect(document.documentElement.dataset.labMode).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /engage lab mode/i }));
    expect(document.documentElement.dataset.labMode).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: /disengage lab mode/i }));
    expect(document.documentElement.dataset.labMode).toBe("false");
  });
});
