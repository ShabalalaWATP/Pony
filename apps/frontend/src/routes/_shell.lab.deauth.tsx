import { createFileRoute, redirect } from "@tanstack/react-router";

/** Deep-link helper — redirects to the lab hub with the Deauth module pre-selected. */
export const Route = createFileRoute("/_shell/lab/deauth")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/lab", search: { module: "deauth" } });
  },
});
