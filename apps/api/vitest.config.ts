import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Reuses @showme/db's Testcontainers harness.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Each DB-backed test file boots its OWN Testcontainers Postgres. Left uncapped,
    // Vitest runs ~one file per core (8 here), so ~8 Postgres containers spin up at
    // once and thrash the Docker daemon — the source of the flaky "container setup"
    // failures. Cap concurrency so at most 4 containers exist at any time: still
    // parallel, far gentler on Docker. Both pools are set in case the default
    // ("forks") ever changes.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
      threads: { maxThreads: 4, minThreads: 1 },
    },
  },
});
