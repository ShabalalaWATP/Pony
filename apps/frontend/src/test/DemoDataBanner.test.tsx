import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoDataBanner } from "@/components/layout/DemoDataBanner";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const DISMISS_KEY = "cp-demo-banner-dismissed";

describe("DemoDataBanner", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(DISMISS_KEY);
  });
  afterEach(() => {
    window.sessionStorage.removeItem(DISMISS_KEY);
  });

  it("renders nothing when the backend reports zero synthetic records", async () => {
    server.use(
      http.get("/api/v1/system/demo-status", () =>
        HttpResponse.json({ synthetic_records: 0, last_seeded_at: null }),
      ),
    );
    const { node } = withQuery(<DemoDataBanner />);
    render(node);
    // Wait long enough for the query to resolve, then assert nothing.
    await waitFor(() => {
      expect(screen.queryByTestId("demo-data-banner")).toBeNull();
    });
  });

  it("renders an amber banner with the count when the backend reports synthetic records", async () => {
    server.use(
      http.get("/api/v1/system/demo-status", () =>
        HttpResponse.json({ synthetic_records: 5217, last_seeded_at: "2026-05-18T12:00:00Z" }),
      ),
    );
    const { node } = withQuery(<DemoDataBanner />);
    render(node);
    const banner = await screen.findByTestId("demo-data-banner");
    expect(banner).toHaveTextContent(/demo data loaded/i);
    expect(banner).toHaveTextContent("5217");
  });

  it("hides after dismiss + persists the dismissal in sessionStorage", async () => {
    server.use(
      http.get("/api/v1/system/demo-status", () =>
        HttpResponse.json({ synthetic_records: 1, last_seeded_at: null }),
      ),
    );
    const { node } = withQuery(<DemoDataBanner />);
    render(node);
    await screen.findByTestId("demo-data-banner");
    await userEvent.click(screen.getByTestId("demo-data-banner-dismiss"));
    expect(screen.queryByTestId("demo-data-banner")).toBeNull();
    expect(window.sessionStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("stays hidden on remount when the session was already dismissed", async () => {
    server.use(
      http.get("/api/v1/system/demo-status", () =>
        HttpResponse.json({ synthetic_records: 2, last_seeded_at: null }),
      ),
    );
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    const { node } = withQuery(<DemoDataBanner />);
    render(node);
    // Give the query a chance to fetch; banner must remain hidden.
    await waitFor(() => {
      expect(screen.queryByTestId("demo-data-banner")).toBeNull();
    });
  });

  it("graceful-degrades to nothing when the backend predates the endpoint (404)", async () => {
    server.use(
      http.get("/api/v1/system/demo-status", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQuery(<DemoDataBanner />);
    render(node);
    await waitFor(() => {
      expect(screen.queryByTestId("demo-data-banner")).toBeNull();
    });
  });
});
