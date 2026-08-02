import { type Database, createDatabase } from "@showme/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PubSub, channelName, createPubSub, publish } from "./pubsub";

/**
 * TDD for the LISTEN/NOTIFY backbone against real Postgres. pg_notify and LISTEN
 * need no schema, so a bare container (no migrations) is enough — we start it
 * directly to obtain the connection URI both the listener and the publisher share.
 */
describe("pubsub", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let pubsub: PubSub;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const connectionString = container.getConnectionUri();
    database = createDatabase(connectionString);
    pubsub = createPubSub(connectionString);
  });

  afterAll(async () => {
    await pubsub.close();
    await container.stop();
  });

  /** Resolve with the first payload a handler receives, or reject after a timeout. */
  function nextPayload(uid: string): {
    received: Promise<string>;
    ready: Promise<() => Promise<void>>;
  } {
    let resolvePayload!: (payload: string) => void;
    let rejectPayload!: (reason: Error) => void;
    const received = new Promise<string>((resolve, reject) => {
      resolvePayload = resolve;
      rejectPayload = reject;
    });
    const timer = setTimeout(() => rejectPayload(new Error(`no event for ${uid}`)), 5_000);
    const ready = pubsub.subscribe(uid, (payload) => {
      clearTimeout(timer);
      resolvePayload(payload);
    });
    return { received, ready };
  }

  it("uses a per-user channel name", () => {
    expect(channelName("abc123")).toBe("showme_user_abc123");
  });

  it("delivers a published payload to a subscriber on the same channel", async () => {
    const { received, ready } = nextPayload("user-a");
    const unsubscribe = await ready;

    await publish(database, "user-a", { kind: "hold.updated", holdId: "h1" });

    const payload = await received;
    expect(JSON.parse(payload)).toEqual({ kind: "hold.updated", holdId: "h1" });

    await unsubscribe();
  });

  it("isolates channels: a subscriber does not receive another user's events", async () => {
    const seenByA: string[] = [];
    const unsubscribeA = await pubsub.subscribe("user-a", (payload) => {
      seenByA.push(payload);
    });
    const { received: receivedByB, ready: readyB } = nextPayload("user-b");
    const unsubscribeB = await readyB;

    await publish(database, "user-b", { kind: "ping" });

    // B's event arrives; A must have seen nothing on B's channel.
    const payloadForB = await receivedByB;
    expect(JSON.parse(payloadForB)).toEqual({ kind: "ping" });
    expect(seenByA).toHaveLength(0);

    await unsubscribeA();
    await unsubscribeB();
  });

  it("fans one channel out to multiple subscribers of the same user", async () => {
    const first = nextPayload("user-c");
    const unsubscribeFirst = await first.ready;
    const second = nextPayload("user-c");
    const unsubscribeSecond = await second.ready;

    await publish(database, "user-c", { kind: "message.new" });

    expect(JSON.parse(await first.received)).toEqual({ kind: "message.new" });
    expect(JSON.parse(await second.received)).toEqual({ kind: "message.new" });

    await unsubscribeFirst();
    await unsubscribeSecond();
  });
});
