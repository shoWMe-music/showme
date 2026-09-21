import { describe, expect, it } from "vitest";
import { createDatabase, createSqlClient } from "./client";

/**
 * THE POOL, PINNED (2026-09-21).
 *
 * postgres-js defaults to `max: 10` with `idle_timeout: null` — ten connections
 * per client, an idle one never closed. On Cloud Run that is ten sockets parked
 * per instance for the life of the container, and with `maxScale: 20` a ceiling
 * of 200 against a `max_connections` of 100. Production was holding 23 with six
 * accounts and no traffic before this was capped.
 *
 * These assert the numbers rather than the plumbing, because the failure is
 * silent: the defaults come back the moment someone constructs a client without
 * options, and nothing goes red until a spike exhausts the database.
 */
const SOCKET_URL =
  "postgresql://postgres:pw@/showme?host=/cloudsql/prod-showme:europe-north2:showme-production-db";
const TCP_URL = "postgres://postgres:postgres@127.0.0.1:55432/showme";

/** Drizzle keeps the postgres-js client on its session; this is how to see it. */
const clientOf = (db: ReturnType<typeof createDatabase>) =>
  (
    db as unknown as {
      session: { client: { options: Record<string, unknown>; end: () => Promise<void> } };
    }
  ).session.client;

describe("the pool the API actually gets", () => {
  /**
   * THE ONE THAT BINDS. Every other test here constructs a client with explicit
   * options, so they pin the numbers but would stay green if `createDatabase`
   * stopped passing them — which is exactly the shape CLAUDE.md warns about:
   * a check that cannot fail on the thing it appears to cover. Verified by
   * restoring postgres-js's defaults and watching only this one go red.
   */
  it("is capped, not postgres-js's ten-connection default", async () => {
    const client = clientOf(createDatabase(TCP_URL));
    expect(client.options.max).toBe(4);
    expect(client.options.idle_timeout).toBe(30);
    await client.end();
  });
});

describe("the connection pool is sized for a serverless caller", () => {
  it("caps a socket client well under max_connections", async () => {
    const sql = createSqlClient(SOCKET_URL, { max: 4, idle_timeout: 30 });
    // 20 Cloud Run instances x 4 = 80, against a limit of 100.
    expect(sql.options.max).toBe(4);
    expect(sql.options.max * 20).toBeLessThan(100);
    await sql.end();
  });

  it("releases idle connections instead of parking them forever", async () => {
    // The half that makes the steady state honest: postgres-js's own default
    // here is `null`, which never closes anything.
    const sql = createSqlClient(SOCKET_URL, { max: 4, idle_timeout: 30 });
    expect(sql.options.idle_timeout).toBe(30);
    expect(sql.options.idle_timeout).not.toBeNull();
    await sql.end();
  });

  it("applies the same options to an ordinary TCP url", async () => {
    // The socket and non-socket branches are separate returns; a cap applied to
    // only one of them is the kind of thing that holds in prod and not in dev.
    const sql = createSqlClient(TCP_URL, { max: 4, idle_timeout: 30 });
    expect(sql.options.max).toBe(4);
    expect(sql.options.idle_timeout).toBe(30);
    await sql.end();
  });

  it("lets a long-running consumer ask for a single connection", async () => {
    // The stream service holds ONE dedicated LISTEN socket; a second would be a
    // second subscription.
    const sql = createSqlClient(SOCKET_URL, { max: 1 });
    expect(sql.options.max).toBe(1);
    await sql.end();
  });

  it("still resolves the socket url to the right unix socket", async () => {
    // Assert `path`, not `host`. A Cloud SQL instance name is
    // `project:region:instance`, and postgres-js splits `host` on the colon — so
    // `options.host` reads as a truncated `/cloudsql/prod-showme` and looks
    // broken while the connection is perfectly correct. `path` is what a unix
    // socket connection actually dials, and it keeps the whole name.
    const sql = createSqlClient(SOCKET_URL, { max: 1 });
    expect(sql.options.path).toBe(
      "/cloudsql/prod-showme:europe-north2:showme-production-db/.s.PGSQL.5432",
    );
    await sql.end();
  });
});
