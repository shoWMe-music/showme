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
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17-alpine",
  ).start();

  const client = postgres(container.getConnectionUri(), { max: 1 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}
