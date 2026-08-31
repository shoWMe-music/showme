import { sql } from "drizzle-orm";
import type { Database } from "./client";

/**
 * The SENDING side of the realtime backbone: emit an event onto a user's Postgres
 * channel via `pg_notify`. The dedicated stream service LISTENs on the matching
 * `showme_user_<uid>` channel (see `apps/stream/src/pubsub.ts`) and fans each
 * payload out to that user's connected SSE clients. Framework-agnostic and
 * dependency-free so any caller can reach it through its pooled Database
 * connection, independent of any listener.
 *
 * WHY IT LIVES IN `@showme/db` AND NOT `apps/api/src/lib`: `notify.ts` beside it
 * publishes every notification it writes, and that module is shared by `apps/api`
 * and `apps/jobs` for the reason its own header gives. This is a `pg_notify`
 * statement over a `Database` and nothing else — the same shape as
 * `representation-termination.ts`.
 */

const CHANNEL_PREFIX = "showme_user_";

/** The Postgres channel a user's realtime events travel on — matches the stream service. */
export function channelName(userId: string): string {
  return `${CHANNEL_PREFIX}${userId}`;
}

/**
 * Publish `payload` to a user's channel. `payload` is JSON-encoded and delivered
 * as-is to that user's SSE clients. Callers wrap this in try/catch so a notify
 * failure never breaks the mutation that triggered it.
 */
export async function publish(database: Database, userId: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  await database.execute(sql`select pg_notify(${channelName(userId)}, ${body})`);
}
