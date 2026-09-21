import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Builds a Drizzle client over a postgres-js connection. Callers own the
 * connection string (Secret Manager in production) — this package stays
 * config-agnostic so it can be used from the API, the stream service, and tests
 * (Testcontainers) without importing any environment.
 */
/**
 * Open a postgres-js connection — THE one place that knows how to read a
 * connection string, used by the API (via `createDatabase`) and by the stream
 * service's LISTEN client. A normal TCP URL is passed straight through.
 * The Cloud SQL unix-socket form `postgres://user:pass@/db?host=/cloudsql/INSTANCE`
 * can't go through postgres-js as a URL (it can't parse the empty host and ignores
 * the `?host=` query), so we pull the parts out and pass the socket directory as
 * the `host` option instead — postgres-js then connects to `<host>/.s.PGSQL.5432`.
 */
export function createSqlClient(connectionString: string, options: Record<string, unknown> = {}) {
  const socket = connectionString.match(/[?&]host=(\/[^&]+)/);
  if (!socket) return postgres(connectionString, options);
  const user = decodeURIComponent(connectionString.match(/:\/\/([^:/@]+):/)?.[1] ?? "");
  const password = decodeURIComponent(connectionString.match(/:\/\/[^:/@]+:([^@]*)@/)?.[1] ?? "");
  const database = connectionString.match(/@[^/]*\/([^?]+)/)?.[1] ?? "";
  return postgres({
    host: decodeURIComponent(socket[1] ?? ""),
    database,
    username: user,
    password,
    ssl: false,
    ...options,
  });
}

export function createDatabase(connectionString: string) {
  return drizzle(createSqlClient(connectionString), { schema });
}

export type Database = ReturnType<typeof createDatabase>;
