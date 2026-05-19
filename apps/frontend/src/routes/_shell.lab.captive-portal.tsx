import { createFileRoute, redirect } from "@tanstack/react-router";

/** Deep-link helper — redirects to the lab hub with the Captive Portal module pre-selected. */
export const Route = createFileRoute("/_shell/lab/captive-portal")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/lab", search: { module: "captive-portal" } });
  },
});
