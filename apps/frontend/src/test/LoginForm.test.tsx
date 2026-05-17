import { HttpResponse, http } from "msw";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { AUTH_QUERY_KEY } from "@/services/auth/hooks";
import { fixtures } from "./msw/handlers";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

async function fillCredentials(email: string, password: string): Promise<void> {
  const inputs = await screen.findAllByDisplayValue("");
  fireEvent.change(inputs[0]!, { target: { value: email } });
  fireEvent.change(inputs[1]!, { target: { value: password } });
}

describe("LoginForm", () => {
  it("populates the auth cache on successful login", async () => {
    const { qc, node } = withQueryAndRouter(<LoginForm />);
    qc.setQueryData(AUTH_QUERY_KEY, null);
    render(node);
    await fillCredentials(fixtures.user.email, "rightpass");
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    await waitFor(() => {
      expect(qc.getQueryData(AUTH_QUERY_KEY)).not.toBeNull();
    });
  });

  it("shows an alert for invalid credentials", async () => {
    const { qc, node } = withQueryAndRouter(<LoginForm />);
    qc.setQueryData(AUTH_QUERY_KEY, null);
    render(node);
    await fillCredentials(fixtures.user.email, "wrong");
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid credentials/i);
  });

  it("advances to the TOTP step when totp_enabled is true on the user", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          { csrf_token: fixtures.csrf, user: { ...fixtures.user, totp_enabled: true } },
          { status: 200 },
        ),
      ),
    );
    const { qc, node } = withQueryAndRouter(<LoginForm />);
    qc.setQueryData(AUTH_QUERY_KEY, null);
    render(node);
    await fillCredentials(fixtures.user.email, "right");
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/enter the 6-digit code/i)).toBeInTheDocument();
  });
});
