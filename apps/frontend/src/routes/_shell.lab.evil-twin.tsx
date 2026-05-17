import { createFileRoute, redirect } from "@tanstack/react-router";

/** Deep-link helper — redirects to the lab hub with the Evil Twin module pre-selected. */
export const Route = createFileRoute("/_shell/lab/evil-twin")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/lab", search: { module: "evil-twin" } });
  },
});
