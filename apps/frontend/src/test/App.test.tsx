import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/App";

describe("App", () => {
  it("mounts the router and lands on Overview by default", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    });
  });
});
