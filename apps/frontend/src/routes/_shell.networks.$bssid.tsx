import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/networks/$bssid")({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/networks",
      search: { bssid: params.bssid },
    });
  },
});
