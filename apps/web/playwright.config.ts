import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4174", trace: "on-first-retry" },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4174",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
