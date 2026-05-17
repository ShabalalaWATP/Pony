import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlertRuleForm } from "@/components/alerts/AlertRuleForm";
import { fixtures } from "./msw/handlers";

describe("AlertRuleForm", () => {
  it("requires a name", async () => {
    const onSubmit = vi.fn();
    render(<AlertRuleForm submitLabel="Create" onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects array predicates as non-objects", async () => {
    const onSubmit = vi.fn();
    render(<AlertRuleForm submitLabel="Create" onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^name$/i), "X");
    // userEvent.type parses `[` as a special key; set the textarea value
    // directly so we can paste raw JSON.
    fireEvent.change(screen.getByLabelText(/predicate/i), { target: { value: "[1,2,3]" } });
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/predicate must be a json object/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("seeds from an existing rule and emits the patch on submit", async () => {
    const onSubmit = vi.fn();
    render(
      <AlertRuleForm
        submitLabel="Save changes"
        initial={fixtures.alertRule}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const nameInput = screen.getByLabelText<HTMLInputElement>(/^name$/i);
    expect(nameInput.value).toBe(fixtures.alertRule.name);
    await userEvent.click(screen.getByRole("button", { name: /^save changes$/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.name).toBe(fixtures.alertRule.name);
    expect(payload.severity).toBe(fixtures.alertRule.severity);
    expect(payload.predicate).toEqual(fixtures.alertRule.predicate);
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(<AlertRuleForm submitLabel="Create" onCancel={onCancel} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
