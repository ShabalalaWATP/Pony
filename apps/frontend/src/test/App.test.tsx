import { describe, expect, it } from "vitest";
import { App } from "@/App";

describe("App", () => {
  it("is exported as a function component", () => {
    // The App component composes the QueryClientProvider + RouterProvider.
    // A full mount of all 24 routes + shell + devtools is exercised
    // indirectly by AppShell.test.tsx and the route tests; mounting it
    // here was OOMing the worker on Windows.
    expect(typeof App).toBe("function");
    expect(App.name).toBe("App");
  });
});
