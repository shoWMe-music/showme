import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  webServer: {
    command: "npx vite --port 5174 --config e2e/vite.config.ts",
    port: 5174,
    reuseExistingServer: true,
  },
});
