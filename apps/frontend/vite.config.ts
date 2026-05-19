import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    // Router plugin runs first so generated routes are present before
    // React picks them up for HMR.
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // MapLibre is intrinsically large (~800 kB minified) and is the only
    // chunk over the default 500 kB warning. It's lazy-imported in
    // `MapView`, so the cost is only paid when the operator visits the
    // map route — not on initial dashboard load. Raise the threshold to
    // silence the noise; the lazy-load already gates the actual UX cost.
    chunkSizeWarningLimit: 850,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy API + WS calls to the backend so cookies are same-origin in
      // development and we avoid the CORS preflight on every request.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // jsdom + msw + TanStack Router accumulates heap fast on Windows.
    // Forks give each test file a fresh process heap; bounded fork
    // count keeps total memory under control.
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
        execArgv: ["--max-old-space-size=4096"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/**/index.ts", // barrel re-exports
        "src/test/**",
        "src/main.tsx",
        "src/routeTree.gen.ts",
        // Route files are thin glue (createFileRoute → component); the
        // component itself is unit-tested separately (StubView, AppShell,
        // DesignSystem, etc.). Coverage on these would be busywork.
        "src/routes/**",
        "src/services/api/openapi.d.ts",
      ],
      thresholds: {
        lines: 85,
        // v8's function metric counts every inline arrow, including
        // useEffect cleanup closures that only fire on unmount. The
        // meaningful behavioural metrics — lines, branches, statements —
        // are all 90%+; tightening this past 80% would mean writing
        // unmount-then-assert busywork tests.
        functions: 80,
        branches: 80,
        statements: 85,
      },
    },
  },
});
