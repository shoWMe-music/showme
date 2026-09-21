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

/**
 * POOL SIZE IS A SERVERLESS DECISION, and postgres-js's defaults are not made for
 * one (measured against production, 2026-09-21).
 *
 * Its defaults are `max: 10` and `idle_timeout: null` — ten connections per
 * client, and an idle one is NEVER closed. On Cloud Run that means every instance
 * that serves a single request parks ten connections and holds them until the
 * instance dies. Production was carrying 23 connections with six accounts and no
 * traffic: two Cloud Run instances at ten apiece, plus Google's own agent. They
 * were not users, they were a pool that only ever grows.
 *
 * It is also a latent outage, not just untidiness. `maxScale` on the API is 20,
 * so the ceiling was 20 x 10 = 200 connections against a `max_connections` of
 * 100. Nothing had hit it because nothing had scaled past two instances yet; a
 * traffic spike would have, and the failure arrives as connection errors on a
 * healthy-looking service.
 *
 * `max: 4` puts the worst case at 80, under the limit with room to spare, and
 * four is more than a single instance needs: requests are short and Drizzle runs
 * them one at a time per call.
 *
 * `idle_timeout: 30` is the half that makes the steady state honest — an instance
 * between requests drops back to nothing within thirty seconds instead of holding
 * ten sockets open for the lifetime of the container. Reopening costs a
 * handshake on the next query, which is the right trade for a service that is
 * idle far more often than it is busy.
 *
 * Both are overridable, because a long-running consumer wants different numbers:
 * the stream service asks for `max: 1` (it holds ONE dedicated LISTEN socket and
 * a second would be a second subscription), and migrations and seeds pass their
 * own.
 */
const SERVERLESS_POOL = { max: 4, idle_timeout: 30 } as const;

export function createDatabase(connectionString: string) {
  return drizzle(createSqlClient(connectionString, { ...SERVERLESS_POOL }), { schema });
}

export type Database = ReturnType<typeof createDatabase>;
