import type { Database } from "@showme/db";
import { sql } from "drizzle-orm";
import postgres from "postgres";

/**
 * The realtime backbone: one dedicated Postgres LISTEN connection that receives
 * `NOTIFY showme_user_<uid>` and fans the payloads out to that user's connected
 * SSE clients in-process (PLAN.md: "one SSE stream per user via Postgres
 * LISTEN/NOTIFY"). Publishing is a separate helper so the API service can emit
 * events through its own pooled connection without owning a listener.
 */

const CHANNEL_PREFIX = "showme_user_";

/** The Postgres channel a user's events travel on. */
export function channelName(uid: string): string {
  return `${CHANNEL_PREFIX}${uid}`;
}

/** Called with the raw JSON payload string for every event on a user's channel. */
export type EventHandler = (payload: string) => void;

/** Removes a single handler; tears the underlying LISTEN down once none remain. */
export type Unsubscribe = () => Promise<void>;

export interface PubSub {
  /**
   * Register `handler` for a user's channel, establishing the Postgres LISTEN on
   * first subscriber. Resolves once the LISTEN is live, so a subsequent publish
   * is guaranteed to reach it.
   */
  subscribe(uid: string, handler: EventHandler): Promise<Unsubscribe>;
  /** Close the dedicated LISTEN connection. */
  close(): Promise<void>;
}

type ChannelSubscription = Awaited<ReturnType<postgres.Sql["listen"]>>;

interface ChannelEntry {
  handlers: Set<EventHandler>;
  subscription: Promise<ChannelSubscription>;
}

/**
 * Open the shared LISTEN connection. `max: 1` keeps a single dedicated socket for
 * listening — notifies from any other connection still arrive, since LISTEN/NOTIFY
 * is cross-connection by design.
 */
export function createPubSub(connectionString: string): PubSub {
  const listenClient = postgres(connectionString, { max: 1 });
  const channels = new Map<string, ChannelEntry>();

  async function subscribe(uid: string, handler: EventHandler): Promise<Unsubscribe> {
    let entry = channels.get(uid);
    if (!entry) {
      const handlers = new Set<EventHandler>();
      // The callback reads `handlers` live at notify time, so a handler added
      // between here and the awaited LISTEN still receives events.
      const subscription = listenClient.listen(channelName(uid), (payload) => {
        for (const registered of handlers) {
          registered(payload);
        }
      });
      entry = { handlers, subscription };
      channels.set(uid, entry);
    }
    entry.handlers.add(handler);
    await entry.subscription;

    return async () => {
      const current = channels.get(uid);
      if (!current) {
        return;
      }
      current.handlers.delete(handler);
      if (current.handlers.size === 0) {
        channels.delete(uid);
        const subscription = await current.subscription;
        await subscription.unlisten();
      }
    };
  }

  async function close(): Promise<void> {
    await listenClient.end();
  }

  return { subscribe, close };
}

/**
 * Emit an event to a user's channel via `pg_notify`. `payload` is JSON-encoded and
 * delivered as-is to that user's SSE clients. Runs on the caller's Database (the
 * API's pooled connection), independent of any listener.
 */
export async function publish(database: Database, uid: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  await database.execute(sql`select pg_notify(${channelName(uid)}, ${body})`);
}
