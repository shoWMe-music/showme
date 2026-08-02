import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Testcontainers pulls an image and boots Postgres — give the container
    // lifecycle (beforeAll/afterAll) and the tests room before failing.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
