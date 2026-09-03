import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * A disposable Postgres running the real migrations — the executable spec for the
 * schema. Reused by every package's tests (Testcontainers, per PLAN.md). Call
 * `stop()` in `afterAll` to tear the container down and close the pool.
 */
export interface TestDatabase {
  db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * A SECOND, INDEPENDENT connection to the same database — for the rare test
   * about concurrency, and for nothing else.
   *
   * `db` above is deliberately a one-connection pool, which keeps ordinary tests
   * deterministic and makes anything about concurrency untestable through it:
   * two "parallel" statements simply queue. A race test written against `db`
   * therefore passes whether the race is fixed or not, which is worse than no
   * test — a green line asserting something it never exercised.
   *
   * Lives here rather than in the calling package so the driver stays where the
   * schema is. The caller must `close()` what it opens.
   */
  openSecondConnection: () => {
    db: ReturnType<typeof drizzle<typeof schema>>;
    close: () => Promise<void>;
  };
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:18-alpine",
  ).start();

  const client = postgres(container.getConnectionUri(), { max: 1 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db,
    openSecondConnection: () => {
      const extra = postgres(container.getConnectionUri(), { max: 1 });
      return { db: drizzle(extra, { schema }), close: () => extra.end() };
    },
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}
