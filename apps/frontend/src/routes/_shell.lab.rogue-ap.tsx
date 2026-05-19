import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Deep-link helper — `/lab/rogue-ap` redirects to the hub with the
 * Rogue-AP module pre-selected via `?module=rogue-ap`.
 */
export const Route = createFileRoute("/_shell/lab/rogue-ap")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/lab", search: { module: "rogue-ap" } });
  },
});
