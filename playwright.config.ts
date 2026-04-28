import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  projects: [
    {
      name: "fixtures",
      testMatch: "combobox-scroll.spec.ts",
      use: { baseURL: "http://localhost:5174" },
    },
    {
      name: "app",
      testMatch: ["share-link.spec.ts", "contacts.spec.ts", "budget-save.spec.ts"],
      use: { baseURL: "http://localhost:5173" },
    },
  ],
  webServer: [
    {
      command: "npx vite --port 5174 --config e2e/vite.config.ts",
      port: 5174,
      reuseExistingServer: true,
    },
    {
      command: "VITE_USE_FIREBASE_EMULATORS=true npx vite --port 5173",
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
