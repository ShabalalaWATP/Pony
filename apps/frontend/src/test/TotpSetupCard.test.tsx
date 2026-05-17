import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TotpSetupCard } from "@/components/auth/TotpSetupCard";
import { fixtures } from "./msw/handlers";
import { withQueryAndRouter } from "./helpers";

describe("TotpSetupCard", () => {
  it("renders the begin-setup button when 2FA is off", async () => {
    const { node } = withQueryAndRouter(<TotpSetupCard user={fixtures.user} />);
    render(node);
    expect(await screen.findByRole("button", { name: /begin setup/i })).toBeInTheDocument();
  });

  it("shows an already-enabled card when totp_enabled is true", async () => {
    const { node } = withQueryAndRouter(
      <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
    );
    render(node);
    expect(await screen.findByText(/two-factor authentication is enabled/i)).toBeInTheDocument();
  });

  it("renders the QR + secret after clicking begin setup", async () => {
    const { node } = withQueryAndRouter(<TotpSetupCard user={fixtures.user} />);
    render(node);
    fireEvent.click(await screen.findByRole("button", { name: /begin setup/i }));
    expect(await screen.findByLabelText("TOTP QR code")).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/i)).toBeInTheDocument();
  });

  it("exposes a Re-enrol button on the active card and re-enters setup on click", async () => {
    const { node } = withQueryAndRouter(
      <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
    );
    render(node);
    const reenrol = await screen.findByRole("button", {
      name: /re-enrol two-factor authentication/i,
    });
    fireEvent.click(reenrol);
    expect(await screen.findByLabelText("TOTP QR code")).toBeInTheDocument();
  });
});
