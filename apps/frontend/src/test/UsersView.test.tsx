import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UsersView } from "@/components/settings/UsersView";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

const operator = {
  id: "00000000-0000-0000-0000-000000000010",
  email: "op@cheeky.local",
  roles: ["operator"],
  totp_enabled: false,
};
const admin = {
  id: "00000000-0000-0000-0000-0000000000ad",
  email: "admin@cheeky.local",
  roles: ["admin"],
  totp_enabled: true,
};

function usersListHandler(items: (typeof operator)[]) {
  return http.get("/api/v1/users", () =>
    HttpResponse.json({ items, total: items.length, limit: 500, offset: 0 }),
  );
}

describe("UsersView", () => {
  it("renders the admin-required empty state when the backend refuses (default 403)", async () => {
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    expect(await screen.findByText(/admin \+ 2fa required/i)).toBeInTheDocument();
  });

  it("renders the users table when the backend returns rows", async () => {
    server.use(usersListHandler([operator, admin]));
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    expect(await screen.findByText("op@cheeky.local")).toBeInTheDocument();
    expect(screen.getByText("admin@cheeky.local")).toBeInTheDocument();
    // Operator row → "operator" badge; admin row → "admin" badge.
    expect(screen.getByText("operator")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("opens the edit drawer when a row is clicked", async () => {
    server.use(usersListHandler([operator]));
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    const row = await screen.findByText("op@cheeky.local");
    await userEvent.click(row);
    expect(await screen.findByTestId("edit-user-form")).toBeInTheDocument();
  });

  it("keeps Save disabled until something actually changes", async () => {
    server.use(usersListHandler([operator]));
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    await userEvent.click(await screen.findByText("op@cheeky.local"));
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText("admin"));
    expect(save).not.toBeDisabled();
  });

  it("PATCHes the user with the new roles + reset_totp flag", async () => {
    server.use(usersListHandler([operator]));
    const captured: { body: { roles?: string[] | null; reset_totp?: boolean } | null } = {
      body: null,
    };
    server.use(
      http.patch("/api/v1/users/:userId", async ({ request }) => {
        captured.body = (await request.json()) as {
          roles?: string[] | null;
          reset_totp?: boolean;
        };
        return HttpResponse.json({ ...operator, roles: captured.body?.roles ?? operator.roles });
      }),
    );
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    await userEvent.click(await screen.findByText("op@cheeky.local"));
    await userEvent.click(screen.getByLabelText("admin"));
    await userEvent.click(screen.getByLabelText(/reset totp/i));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.roles).toEqual(["admin", "operator"]);
    expect(captured.body?.reset_totp).toBe(true);
    expect(await screen.findByTestId("edit-user-success")).toBeInTheDocument();
  });

  it("surfaces the 409 last-admin guard inline", async () => {
    server.use(usersListHandler([admin]));
    server.use(
      http.patch("/api/v1/users/:userId", () =>
        HttpResponse.json({ detail: "last admin" }, { status: 409 }),
      ),
    );
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    await userEvent.click(await screen.findByText("admin@cheeky.local"));
    await userEvent.click(screen.getByLabelText("admin"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByTestId("edit-user-error")).toHaveTextContent(/last admin/i);
  });

  it("warns the operator before they remove their own admin role", async () => {
    server.use(usersListHandler([fixtures.adminUser]));
    server.use(
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ csrf_token: fixtures.csrf, user: fixtures.adminUser }),
      ),
    );
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    await userEvent.click(await screen.findByText(fixtures.adminUser.email));
    expect(screen.queryByTestId("self-demote-warning")).toBeNull();
    await userEvent.click(screen.getByLabelText("admin"));
    expect(await screen.findByTestId("self-demote-warning")).toBeInTheDocument();
  });

  it("renders 403 copy inline when the backend refuses the patch", async () => {
    server.use(usersListHandler([operator]));
    server.use(
      http.patch("/api/v1/users/:userId", () =>
        HttpResponse.json({ detail: "Admin required" }, { status: 403 }),
      ),
    );
    const { node } = withQueryAndRouter(<UsersView />);
    render(node);
    await userEvent.click(await screen.findByText("op@cheeky.local"));
    await userEvent.click(screen.getByLabelText("admin"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByTestId("edit-user-error")).toHaveTextContent(
      /admin role \+ recent totp/i,
    );
  });
});
