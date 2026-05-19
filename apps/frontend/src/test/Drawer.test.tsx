import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "@/components/ui/Drawer";

describe("Drawer", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <Drawer open={false} onClose={() => undefined} title="Hidden">
        content
      </Drawer>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title and children when open", () => {
    render(
      <Drawer open onClose={() => undefined} title="Detail">
        <div>body</div>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: /detail/i })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Detail">
        body
      </Drawer>,
    );
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Detail">
        body
      </Drawer>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Detail">
        body
      </Drawer>,
    );
    await userEvent.click(screen.getByRole("button", { name: /close drawer/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
