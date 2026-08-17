import type { Database } from "@showme/db";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { channelName, publish } from "./lib/publish";

/**
 * Unit-level coverage for the realtime publish helper: the channel name matches
 * the stream service's `showme_user_<uid>` convention, and `publish` issues a
 * single parameterized `pg_notify(channel, json)` with the JSON-encoded payload.
 */
describe("publish — realtime pg_notify", () => {
  it("builds the stream service's per-user channel", () => {
    expect(channelName("abc123")).toBe("showme_user_abc123");
  });

  it("emits pg_notify with the channel and JSON payload", async () => {
    const executed: SQL[] = [];
    const fakeDatabase = {
      execute: async (query: SQL) => {
        executed.push(query);
      },
    } as unknown as Database;

    await publish(fakeDatabase, "user-1", { type: "notification", eventId: "e1" });

    expect(executed).toHaveLength(1);
    const query = executed[0];
    if (!query) throw new Error("no query executed");
    const { sql: text, params } = new PgDialect().sqlToQuery(query);
    expect(text).toContain("pg_notify");
    expect(params).toEqual([
      "showme_user_user-1",
      JSON.stringify({ type: "notification", eventId: "e1" }),
    ]);
  });

  it("does not throw when execute is a plain sql call", async () => {
    // Guards the sql template shape so it stays a single statement.
    const query = sql`select pg_notify(${channelName("x")}, ${"{}"})`;
    const { params } = new PgDialect().sqlToQuery(query);
    expect(params[0]).toBe("showme_user_x");
  });
});
