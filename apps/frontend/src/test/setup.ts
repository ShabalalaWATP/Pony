import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

const noop = (): void => undefined;

// jsdom doesn't implement matchMedia — used by useReducedMotion.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom doesn't implement window.scrollTo — TanStack Router calls it when
// matching routes on mount, which would otherwise crash component renders.
if (typeof window !== "undefined" && typeof window.scrollTo !== "function") {
  Object.defineProperty(window, "scrollTo", { writable: true, value: noop });
}

// jsdom doesn't implement Element.scrollIntoView — TanStack Router's
// <Link> calls it on intent-preload, which would otherwise throw and
// trigger the route's CatchBoundary, leaving the test DOM empty.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = noop;
}

// jsdom doesn't implement ResizeObserver — cmdk's <Command.List> uses it
// to size itself.
if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe(): void {
      // noop
    }
    unobserve(): void {
      // noop
    }
    disconnect(): void {
      // noop
    }
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: StubResizeObserver,
  });
}
