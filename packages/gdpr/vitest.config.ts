import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same reason as packages/db: this suite's beforeAll boots a Testcontainers
    // Postgres and runs every migration, which vitest's 10s default hookTimeout
    // does not cover. It squeaked through on a fast laptop and would have failed
    // most runs on a 2-vCPU CI runner — the kind of flake that gets a suite
    // ignored rather than fixed.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
