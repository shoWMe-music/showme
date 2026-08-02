import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Reuses @showme/db's Testcontainers harness.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
