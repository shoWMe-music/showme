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
    /**
     * Built into `dist-e2e`, NOT `dist`.
     *
     * This build is made with EMULATOR configuration (`scripts/stack.mjs` →
     * `webEmulatorEnv`: project `demo-showme`, auth at 127.0.0.1:9099). Left in
     * `dist`, it looks exactly like a deployable build and is not one — and a
     * hosting deploy is a directory upload, so whatever is in `dist` ships.
     *
     * That happened on 2026-08-27: an e2e run before a deploy put the emulator
     * bundle live on `showme-app.web.app`, and the app pointed sign-in at
     * localhost until it was rebuilt and redeployed. Nothing errored at deploy
     * time; the string `demo-showme` in the served bundle was the only evidence.
     * A separate directory is what makes that mistake impossible rather than
     * merely unlikely.
     */
    command: "pnpm build --outDir dist-e2e && pnpm preview --outDir dist-e2e",
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
