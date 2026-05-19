import { setupServer } from "msw/node";
import { authHandlers } from "./handlers";

/**
 * Shared msw server. Each test file imports this and adds its own
 * `beforeAll` / `afterEach` / `afterAll` to start, reset, and stop the
 * server. Default handler set covers the happy-path auth flow; tests
 * override via `server.use(...)` when they need 401s, 5xx, etc.
 */
export const server = setupServer(...authHandlers);
