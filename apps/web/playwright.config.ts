import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. The `setup` project logs every account in once (auth.setup.ts) and
 * saves a per-account session; the `chromium` project depends on it and reuses
 * those sessions via `storageState`. The Firebase Auth emulator, the API, and the
 * Postgres seed are brought up by the orchestrator (`scripts/e2e.mjs`, run via
 * `pnpm test:e2e`) BEFORE `playwright test` — this config only owns the web
 * preview and the browser projects. The web build inherits the emulator env
 * (`VITE_FIREBASE_AUTH_EMULATOR_HOST`, …) from that orchestrator.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4174", trace: "on-first-retry" },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
