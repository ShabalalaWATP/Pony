import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";

// One msw server for every test. Files that need bespoke handlers use
// `server.use(...)` inside their own beforeEach. Unhandled requests fail
// immediately so missing mocks surface as errors instead of hangs.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

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

// jsdom returns 0 for layout dimensions. TanStack Virtual's measurement
// path (offsetHeight + getBoundingClientRect) then reports an empty
// viewport and refuses to render rows. Stub both with sensible defaults
// so virtualised tables render in tests.
if (typeof window !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      const fromAttr = (this as HTMLElement).getAttribute?.("data-test-height");
      return fromAttr ? Number(fromAttr) : 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
    // Always return a non-zero rect — TanStack Virtual and Recharts
    // refuse to render anything when measurements come back 0×0.
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => "",
    };
  };
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
