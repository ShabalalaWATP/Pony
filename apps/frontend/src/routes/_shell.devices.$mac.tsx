import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/devices/$mac")({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/devices",
      search: { mac: params.mac },
    });
  },
});
