import { defineConfig } from "orval";

/**
 * Generates TanStack Query hooks + Zod-derived models from the API's OpenAPI.
 * Every request goes through our custom fetch mutator (src/mutator.ts) so the
 * base URL, auth token, and error handling live in one place.
 *
 * Regenerate after API changes:  pnpm --filter @showme/api-client sync-spec && pnpm --filter @showme/api-client generate
 * (sync-spec re-fetches openapi.json from a locally running API on :8080.)
 */
export default defineConfig({
  showme: {
    input: { target: "./openapi.json" },
    output: {
      mode: "tags-split",
      target: "./src/generated/endpoints.ts",
      schemas: "./src/generated/models",
      client: "react-query",
      clean: true,
      override: {
        mutator: { path: "./src/mutator.ts", name: "customFetch" },
        query: { signal: true },
      },
    },
  },
});
