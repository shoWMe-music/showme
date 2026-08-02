import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Builds a Drizzle client over a postgres-js connection. Callers own the
 * connection string (Secret Manager in production) — this package stays
 * config-agnostic so it can be used from the API, the stream service, and tests
 * (Testcontainers) without importing any environment.
 */
export function createDatabase(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
