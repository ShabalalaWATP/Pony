import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserMenu } from "@/components/auth/UserMenu";
import { AUTH_QUERY_KEY } from "@/services/auth/hooks";
import { fixtures } from "./msw/handlers";
import { withQueryAndRouter } from "./helpers";

describe("UserMenu", () => {
  it("renders nothing when there's no current user", () => {
    const { qc, node } = withQueryAndRouter(<UserMenu />);
    qc.setQueryData(AUTH_QUERY_KEY, null);
    const { container } = render(node);
    expect(container.querySelector("[aria-label='Open user menu']")).toBeNull();
  });

  it("opens the menu and shows the user email + menu items", async () => {
    const { qc, node } = withQueryAndRouter(<UserMenu />);
    qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: fixtures.csrf, user: fixtures.user });
    render(node);
    fireEvent.click(await screen.findByLabelText(/open user menu/i));
    expect(screen.getByText(fixtures.user.email)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /account & security/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("signs out and clears the auth cache", async () => {
    const { qc, node } = withQueryAndRouter(<UserMenu />);
    qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: fixtures.csrf, user: fixtures.user });
    render(node);
    fireEvent.click(await screen.findByLabelText(/open user menu/i));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    await waitFor(() => {
      expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
    });
  });
});
