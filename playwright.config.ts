import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

/**
 * End-to-end tests run against a production build with a fresh embedded
 * database (./data/pglite-e2e) and password auth enabled. No AI key is set, so
 * the tests also cover the "AI not configured" paths.
 *
 * Set E2E_DATABASE_URL to an EMPTY PostgreSQL database to run the same suite
 * against PostgreSQL instead (migrations are applied automatically).
 */
const pgUrl = process.env.E2E_DATABASE_URL ?? "";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    timezoneId: "America/New_York",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf ./data/pglite-e2e && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PGLITE_DIR: "./data/pglite-e2e",
      APP_PASSWORD: "e2e-correct-horse",
      SESSION_SECRET: "e2e-session-secret-0123456789-abcdefghijklmnop",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      DATABASE_URL: pgUrl,
      AUTO_MIGRATE: pgUrl ? "true" : "false",
    },
  },
});
