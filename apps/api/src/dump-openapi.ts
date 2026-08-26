/**
 * Emit the OpenAPI document to stdout without booting a server or a database.
 * Registering routes only builds their schemas, so a placeholder `database` is
 * never dialled — which is what lets `pnpm generate` run on a laptop with
 * nothing else up. This is the input to orval (`packages/api-client`).
 */
import type { Database } from "@showme/db";
import { buildApp } from "./app";

const app = buildApp({
  database: {} as Database,
  tokenVerifier: {
    async verify() {
      throw new Error("not used for the spec");
    },
  },
});

await app.ready();
process.stdout.write(JSON.stringify(app.swagger(), null, 2));
await app.close();
