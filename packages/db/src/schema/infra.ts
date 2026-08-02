import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

/**
 * Idempotency keys (decisions #8). Every retry-unsafe mutation (money moves,
 * creates, sends, gapless sequences) sends `Idempotency-Key: <uuid>`; the first
 * execution stores its result here and a replay returns the stored result
 * instead of re-executing. Scoped per `(user, endpoint)`; retention 24h (a reaper
 * prunes rows older than that). "This must not happen twice" → idempotency key;
 * "someone else changed this, reload" → the `version` columns.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(), // the client-supplied uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.endpoint, table.key)],
);
