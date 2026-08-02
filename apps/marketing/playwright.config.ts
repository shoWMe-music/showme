import { defineConfig, devices } from "@playwright/test";

// Tests run against the PRODUCTION build served by `vite preview` — so what we
// validate is exactly what ships (pre-rendered HTML, hashed assets, SEO tags).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173",
    // Always rebuild + serve fresh so tests validate the CURRENT build, never a stale server.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
