import type { Database } from "@showme/db";
import { sql } from "drizzle-orm";

/**
 * The API side of the realtime backbone: emit an event onto a user's Postgres
 * channel via `pg_notify`. The dedicated stream service LISTENs on the matching
 * `showme_user_<uid>` channel (see `apps/stream/src/pubsub.ts`) and fans each
 * payload out to that user's connected SSE clients. Framework-agnostic and
 * dependency-free so any route can call it through its pooled Database connection,
 * independent of any listener.
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
