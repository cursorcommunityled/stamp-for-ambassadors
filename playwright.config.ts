import { defineConfig, devices } from "@playwright/test";
import { APP_ENV, APP_PORT, APP_URL, DATABASE_URL, FAKE_LUMA_PORT } from "./tests/env";

// Test helpers talk to the same database the app under test uses.
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  // One app, one database, rate limits keyed by email: running specs side by
  // side would make them trip over each other's budgets.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npx tsx tests/fake-luma.ts",
      port: FAKE_LUMA_PORT,
      reuseExistingServer: false,
      env: { FAKE_LUMA_PORT: String(FAKE_LUMA_PORT) },
    },
    {
      command: `npx next dev -p ${APP_PORT}`,
      // A port check, not a page: web servers start before global setup has
      // created the database, so any page would answer 500 until then.
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      env: APP_ENV,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
