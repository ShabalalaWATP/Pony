import { HttpResponse, http } from "msw";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TotpSetupCard } from "@/components/auth/TotpSetupCard";
import { fixtures } from "./msw/handlers";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

/**
 * Type a 6-digit TOTP code into a `TotpInput` rendered by the
 * `TotpStepUp` prompt inside the card.
 */
async function typeStepUpCode(code: string): Promise<void> {
  const cells = screen.getAllByLabelText(/digit \d+/i);
  const first = cells[0];
  if (!first) throw new Error("TOTP cells not rendered");
  first.focus();
  await userEvent.keyboard(code);
}

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

  it("exposes a Re-verify button on the active card", async () => {
    const { node } = withQueryAndRouter(
      <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
    );
    render(node);
    expect(
      await screen.findByRole("button", { name: /re-verify a recent two-factor code/i }),
    ).toBeInTheDocument();
  });

  it("opens the verify-only step-up prompt when Re-verify is clicked", async () => {
    const { node } = withQueryAndRouter(
      <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
    );
    render(node);
    await userEvent.click(
      await screen.findByRole("button", { name: /re-verify a recent two-factor code/i }),
    );
    expect(await screen.findByTestId("totp-reverify")).toBeInTheDocument();
    expect(screen.getByText(/re-verify a recent code/i)).toBeInTheDocument();
    expect(screen.getByText(/your existing secret is preserved/i)).toBeInTheDocument();
  });

  describe("re-enrol step-up flow", () => {
    beforeEach(() => {
      // First /auth/2fa/setup call -> 403 totp_required (stale recent
      // window). After /auth/2fa/verify succeeds, swap to a 200 so the
      // automatic retry lands on the QR view. The MSW default verify
      // handler accepts code 123456.
      let setupCalls = 0;
      server.use(
        http.post("/api/v1/auth/2fa/setup", () => {
          setupCalls += 1;
          if (setupCalls === 1) {
            return HttpResponse.json({ detail: "totp_required" }, { status: 403 });
          }
          return HttpResponse.json({
            provisioning_uri:
              "otpauth://totp/Cheeky%20Pony:operator@cheeky.local?secret=NEWQR&issuer=Cheeky%20Pony",
            secret: "NEWQRAFTERSTEPUP",
          });
        }),
      );
    });

    it("surfaces the step-up prompt instead of leaking raw totp_required", async () => {
      const { node } = withQueryAndRouter(
        <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
      );
      render(node);
      await userEvent.click(
        await screen.findByRole("button", { name: /re-enrol two-factor authentication/i }),
      );
      // Step-up appears.
      expect(await screen.findByTestId("totp-reenrol-stepup")).toBeInTheDocument();
      // No raw "totp_required" leaks into the UI.
      expect(screen.queryByText(/^totp_required$/i)).not.toBeInTheDocument();
    });

    it("retries setup after the step-up verifies and lands on the new QR", async () => {
      const { node } = withQueryAndRouter(
        <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
      );
      render(node);
      await userEvent.click(
        await screen.findByRole("button", { name: /re-enrol two-factor authentication/i }),
      );
      await screen.findByTestId("totp-reenrol-stepup");
      await typeStepUpCode("123456");
      // After the auto-retry, the fresh secret from the second /setup
      // call ends up in the QR view.
      expect(await screen.findByLabelText("TOTP QR code")).toBeInTheDocument();
      expect(await screen.findByText(/NEWQRAFTERSTEPUP/i)).toBeInTheDocument();
    });

    it("returns to the active card if the operator cancels the step-up", async () => {
      const { node } = withQueryAndRouter(
        <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
      );
      render(node);
      await userEvent.click(
        await screen.findByRole("button", { name: /re-enrol two-factor authentication/i }),
      );
      await screen.findByTestId("totp-reenrol-stepup");
      await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(screen.queryByTestId("totp-reenrol-stepup")).toBeNull();
      // Active card still present.
      expect(screen.getByTestId("totp-active-card")).toBeInTheDocument();
    });
  });

  describe("verify-only flow", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("verifies a recent code and dismisses the prompt after a brief banner", async () => {
      const { node } = withQueryAndRouter(
        <TotpSetupCard user={{ ...fixtures.user, totp_enabled: true }} />,
      );
      render(node);
      await userEvent.click(
        await screen.findByRole("button", { name: /re-verify a recent two-factor code/i }),
      );
      await screen.findByTestId("totp-reverify");
      await typeStepUpCode("123456");
      expect(await screen.findByText(/verified — continuing/i)).toBeInTheDocument();
      // Auto-dismiss after the 1.2s banner timeout. Wrap the timer
      // advance in `act` so the resulting `setMode("idle")` state
      // update is flushed inside React's batched-update phase.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      await waitFor(() => {
        expect(screen.queryByTestId("totp-reverify")).toBeNull();
      });
    });
  });
});
