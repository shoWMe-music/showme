import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { type CalendarIntegration, refreshTokenSealContext } from "./calendar-integration";
import { applyExternalCalendarDeletions, upsertExternalCalendarEvents } from "./external-calendar";
import {
  GoogleAuthorizationRevokedError,
  GoogleSyncTokenExpiredError,
  type GoogleWatchChannel,
  listCalendarEvents,
  normalizeGoogleEvents,
  refreshAccessToken,
  stopWatchChannel,
  watchCalendarEvents,
} from "./google-calendar";
import { equalsConstantTime } from "./token-encryption";

/**
 * ONE SYNC, END TO END — fetch from the provider, hand the result to the seam,
 * and leave the connection's cursor where the next sync can pick it up.
 *
 * This is the only place the two halves meet. `lib/google-calendar.ts` knows
 * Google and nothing about Postgres; `lib/external-calendar.ts` knows Postgres and
 * nothing about Google. Everything provider-shaped has already stopped by the time
 * a `NormalizedExternalEvent` reaches the seam.
 *
 * ── FIRST SYNC VS SECOND SYNC ────────────────────────────────────────────────
 * **First** (no stored `sync_token`): a full listing of a bounded window, which
 * mints the token. It cannot be told what was deleted — a listing only says what
 * EXISTS — so a full sync reconciles by set difference instead: anything we hold
 * inside the window that the listing did not mention is gone, and is removed.
 *
 * **Second** (a token in hand): Google returns only what changed since, INCLUDING
 * tombstones (`status: "cancelled"`), which is the only way a deletion is ever
 * reported. Typically a handful of events instead of hundreds.
 *
 * ── WHY THE WINDOW HAS TO BE RE-DRAWN OCCASIONALLY ───────────────────────────
 * A sync token inherits the `timeMin`/`timeMax` of the listing that minted it, and
 * Google refuses those parameters alongside a token — so a connection left on
 * incremental syncs forever keeps a horizon that never moves, and an event booked
 * beyond it would never arrive. `last_full_sync_at` is what schedules the re-list.
 *
 * ── AND WHY A REVOKED TOKEN IS STATE, NOT AN EXCEPTION ───────────────────────
 * Anybody may withdraw access from their Google account page at any moment; the
 * next refresh then answers `invalid_grant`. That is an ordinary thing for a user
 * to do, so it is written to the row as `reauthorization_required_at` and shown on
 * the screen as "Reconnect" — not raised as a 500 every hour until somebody reads
 * a log.
 */

/** How far back a full listing reaches. Past nights still explain a busy history. */
export const SYNC_WINDOW_PAST_DAYS = 30;
/** How far forward. Thirteen months covers a booking season and then some. */
export const SYNC_WINDOW_FUTURE_DAYS = 400;
/** How stale a window may get before the next sync re-lists in full. */
export const FULL_RESYNC_AFTER_DAYS = 14;

const MILLISECONDS_PER_DAY = 86_400_000;

/** The columns a sync reads and writes. Passed as a plain row — no ORM required. */
export interface CalendarConnectionRow {
  id: string;
  userId: string;
  profileId: string;
  provider: string;
  providerAccountId: string;
  providerCalendarId: string;
  calendarTimeZone: string | null;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
  syncToken: string | null;
  lastFullSyncAt: Date | null;
}

export interface CalendarSyncResult {
  /** True when this run listed the whole window rather than only the changes. */
  full: boolean;
  imported: number;
  deleted: number;
  keptBecausePromoted: number;
  echoesSkipped: number;
  /** Entries Google returned that shoWMe has no use for (working locations, …). */
  ignored: number;
  calendarTimeZone: string;
  providerAccountId: string;
}

/** Open the sealed refresh token for this row. Throws if it was tampered with. */
export function readRefreshToken(
  integration: CalendarIntegration,
  connection: CalendarConnectionRow,
): string {
  return integration.sealer.open(
    {
      ciphertext: connection.refreshTokenCiphertext,
      iv: connection.refreshTokenIv,
      authTag: connection.refreshTokenAuthTag,
    },
    refreshTokenSealContext(connection),
  );
}

/** `yyyy-mm-dd` for a date `days` from `from`, in UTC — a bare day, not an instant. */
function isoDayOffset(from: Date, days: number): string {
  return new Date(from.getTime() + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Should this run re-list the whole window rather than take the incremental path? */
export function shouldRunFullSync(
  connection: Pick<CalendarConnectionRow, "syncToken" | "lastFullSyncAt">,
  now: Date = new Date(),
): boolean {
  if (!connection.syncToken) return true;
  if (!connection.lastFullSyncAt) return true;
  return (
    now.getTime() - connection.lastFullSyncAt.getTime() >
    FULL_RESYNC_AFTER_DAYS * MILLISECONDS_PER_DAY
  );
}

/**
 * Everything this connection currently holds inside the window, so a full listing
 * can work out what has gone. Scoped to the window because a full listing only
 * knows about the window — reconciling beyond it would delete rows the listing was
 * never asked about.
 */
async function importedExternalIdsInWindow(
  database: Database,
  connection: CalendarConnectionRow,
  window: { from: string; to: string },
): Promise<string[]> {
  const rows = await database
    .select({ externalId: schema.calendarItems.externalId })
    .from(schema.calendarItems)
    .where(
      and(
        eq(schema.calendarItems.externalSource, connection.provider),
        eq(schema.calendarItems.ownerProfileId, connection.profileId),
        eq(schema.calendarItems.ownerUserId, connection.userId),
        isNotNull(schema.calendarItems.externalId),
        gte(schema.calendarItems.date, window.from),
        lte(schema.calendarItems.date, window.to),
      ),
    );
  return rows.flatMap((row) => (row.externalId ? [row.externalId] : []));
}

/**
 * Run one sync for one connection and persist the outcome.
 *
 * Throws `GoogleAuthorizationRevokedError` after having ALREADY recorded the
 * revocation on the row — the caller's job is to turn it into a message, not to
 * remember to write state.
 */
export async function syncCalendarConnection(
  database: Database,
  integration: CalendarIntegration,
  connection: CalendarConnectionRow,
  now: Date = new Date(),
): Promise<CalendarSyncResult> {
  let accessToken: string;
  try {
    const refreshToken = readRefreshToken(integration, connection);
    const grant = await refreshAccessToken(integration.googleOAuthClient, refreshToken);
    accessToken = grant.accessToken;
  } catch (error) {
    if (error instanceof GoogleAuthorizationRevokedError) {
      await markReauthorizationRequired(database, connection.id, error.detail, now);
    }
    throw error;
  }

  const window = {
    from: isoDayOffset(now, -SYNC_WINDOW_PAST_DAYS),
    to: isoDayOffset(now, SYNC_WINDOW_FUTURE_DAYS),
  };
  const listWindow = {
    timeMin: new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * MILLISECONDS_PER_DAY).toISOString(),
    timeMax: new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * MILLISECONDS_PER_DAY).toISOString(),
  };

  let full = shouldRunFullSync(connection, now);
  const listing = await listCalendarEvents({
    accessToken,
    calendarId: connection.providerCalendarId,
    syncToken: full ? null : connection.syncToken,
    ...(full ? listWindow : {}),
    fetchImplementation: integration.googleOAuthClient.fetchImplementation,
  }).catch(async (error) => {
    // 410 GONE: the stored cursor aged out. Documented, expected, and the remedy
    // is the one below — drop it and re-list. Retried once, never in a loop.
    if (!(error instanceof GoogleSyncTokenExpiredError)) throw error;
    full = true;
    return listCalendarEvents({
      accessToken,
      calendarId: connection.providerCalendarId,
      syncToken: null,
      ...listWindow,
      fetchImplementation: integration.googleOAuthClient.fetchImplementation,
    });
  });

  // The calendar's own zone decides what the imported wall-clock times MEAN, so a
  // listing that did not carry one falls back to the last one we saw and then to
  // UTC. Never to the server's zone: Cloud Run runs in UTC and a laptop does not,
  // which would make the same calendar import differently in two places.
  const calendarTimeZone = listing.calendarTimeZone ?? connection.calendarTimeZone ?? "UTC";
  const providerAccountId = listing.calendarSummary ?? connection.providerAccountId;

  const batch = normalizeGoogleEvents(listing.events, calendarTimeZone);

  const upserted = await upsertExternalCalendarEvents(database, {
    provider: connection.provider,
    ownerProfileId: connection.profileId,
    ownerUserId: connection.userId,
    events: batch.events,
  });

  // A full listing says what EXISTS, never what went — so the deletions have to be
  // inferred. Everything held inside the window that the listing did not mention
  // is gone from the far side, and leaving it would keep a night blocked by a
  // meeting cancelled weeks ago.
  const deletionIds = new Set(batch.deletedExternalIds);
  if (full) {
    const seen = new Set(batch.events.map((event) => event.externalId));
    for (const externalId of await importedExternalIdsInWindow(database, connection, window)) {
      if (!seen.has(externalId)) deletionIds.add(externalId);
    }
  }

  const removals = await applyExternalCalendarDeletions(database, {
    provider: connection.provider,
    ownerProfileId: connection.profileId,
    ownerUserId: connection.userId,
    externalIds: [...deletionIds],
  });

  await database
    .update(schema.calendarConnections)
    .set({
      // Only a LAST page carries a sync token; keep the old one rather than
      // clearing the cursor and silently downgrading every future sync to a full
      // listing that can no longer learn about deletions.
      syncToken: listing.nextSyncToken ?? connection.syncToken,
      calendarTimeZone,
      providerAccountId,
      lastSyncedAt: now,
      lastFullSyncAt: full ? now : connection.lastFullSyncAt,
      // A sync that got this far proves the grant is live — so any earlier
      // "reconnect" state is stale and must not keep nagging.
      reauthorizationRequiredAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(schema.calendarConnections.id, connection.id));

  return {
    full,
    imported: upserted.upserted,
    deleted: removals.deleted,
    keptBecausePromoted: removals.keptBecausePromoted,
    echoesSkipped: upserted.echoesSkipped,
    ignored: batch.ignored,
    calendarTimeZone,
    providerAccountId,
  };
}

/**
 * Record that the far side stopped accepting our refresh token. The screen reads
 * this and offers Reconnect; nothing here deletes the row, because the user's
 * "available anyway" overrides and promoted shows hang off the entries it wrote.
 */
export async function markReauthorizationRequired(
  database: Database,
  connectionId: string,
  detail: string,
  now: Date = new Date(),
): Promise<void> {
  await database
    .update(schema.calendarConnections)
    .set({
      reauthorizationRequiredAt: now,
      lastError: detail.slice(0, 500) || "invalid_grant",
      updatedAt: now,
    })
    .where(eq(schema.calendarConnections.id, connectionId));
}

/**
 * Is the stored grant still live? One refresh, nothing listed, nothing written.
 *
 * It exists to make a disconnect PROVABLE: revoking at Google is only meaningful
 * if the token stops working afterwards, and "we called the revoke endpoint" is
 * not the same claim as "the key is dead". This is how the difference is checked.
 */
export async function connectionGrantIsLive(
  integration: CalendarIntegration,
  connection: CalendarConnectionRow,
): Promise<boolean> {
  try {
    await refreshAccessToken(
      integration.googleOAuthClient,
      readRefreshToken(integration, connection),
    );
    return true;
  } catch (error) {
    if (error instanceof GoogleAuthorizationRevokedError) return false;
    throw error;
  }
}

/* ────────────────────────────────────────────────────── the push channel ─── */

/**
 * REGISTERING A WATCH, and the three things about it that decide the design.
 *
 * 1. **The notification is empty.** Google POSTs headers and no body: a channel
 *    id, a resource id, a state, a message number, and the token we registered.
 *    It never says WHAT changed. So the handler's entire job is to find the
 *    connection and run the incremental sync — the same path "Sync now" drives,
 *    which already knows how to ask "what has moved since my cursor".
 * 2. **The token is the only authentication.** The receiving route is public
 *    because Google will not send a Firebase token, and the notification carries
 *    no user identity. A per-channel unguessable secret, echoed back and checked,
 *    is what stands between a real ping and anybody with the URL. Only its DIGEST
 *    is stored, so a leak of the table cannot be turned into a forged ping.
 * 3. **A channel expires**, within about a week. That is why the expiry is stored
 *    and surfaced: a lapsed channel is a calendar that has silently stopped
 *    updating, and the screen has to be able to say so.
 *
 * WHAT THE RENEWAL JOB WOULD DO — not built, because `infra/modules/scheduled-jobs`
 * is written but not applied, so there is nowhere to run it. When it ships:
 *   · every few hours, select connections whose `channel_expires_at` is inside the
 *     next 24 hours and that are not flagged for reauthorization;
 *   · for each, register a NEW channel (a fresh id and a fresh token) BEFORE
 *     stopping the old one, so no window exists in which changes are missed;
 *   · persist the new triple, then `channels.stop` the old id/resourceId;
 *   · on `invalid_grant`, stop trying and mark the connection for reconnection —
 *     the user has revoked us and a channel cannot outlive the grant;
 *   · leave a connection whose watch keeps failing on manual sync rather than
 *     retrying forever; the screen already tells the truth about that state.
 */

/** A fresh channel secret. Never stored — only its digest is. */
export function createChannelToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The digest that goes in the row. SHA-256 of the token, hex. */
export function hashChannelToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Does the token Google echoed match the one this channel was registered with?
 * Constant-time on the digests — a byte-at-a-time comparison of the only
 * authentication a public route has is an oracle for forging it.
 */
export function channelTokenMatches(presented: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  return equalsConstantTime(
    Buffer.from(hashChannelToken(presented), "hex"),
    Buffer.from(storedHash, "hex"),
  );
}

/** Is this connection currently receiving pushes? */
export function pushChannelIsLive(
  connection: { channelId: string | null; channelExpiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!connection.channelId) return false;
  if (!connection.channelExpiresAt) return false;
  return connection.channelExpiresAt.getTime() > now.getTime();
}

/**
 * Ask Google to push changes for this connection, and record the channel.
 *
 * Returns null rather than throwing when push is unavailable — no webhook address
 * configured, or Google refusing the address. A calendar that syncs only when
 * asked is a working calendar; failing the connect over it would be a worse
 * outcome than the degraded one, and the screen says which mode it is in.
 */
export async function registerCalendarPushChannel(
  database: Database,
  integration: CalendarIntegration,
  connection: CalendarConnectionRow,
  now: Date = new Date(),
): Promise<GoogleWatchChannel | null> {
  if (!integration.webhookUrl) return null;

  const grant = await refreshAccessToken(
    integration.googleOAuthClient,
    readRefreshToken(integration, connection),
  );
  const token = createChannelToken();
  const channel = await watchCalendarEvents({
    accessToken: grant.accessToken,
    calendarId: connection.providerCalendarId,
    // The channel id doubles as the lookup key on an unauthenticated route, so it
    // is random rather than the connection's uuid — a ping should not disclose a
    // primary key, and a guessed id must not even find a row to compare against.
    channelId: randomBytes(16).toString("hex"),
    address: integration.webhookUrl,
    token,
    fetchImplementation: integration.googleOAuthClient.fetchImplementation,
  });

  await database
    .update(schema.calendarConnections)
    .set({
      channelId: channel.channelId,
      resourceId: channel.resourceId,
      channelTokenHash: hashChannelToken(token),
      channelExpiresAt: channel.expiresAt,
      updatedAt: now,
    })
    .where(eq(schema.calendarConnections.id, connection.id));

  return channel;
}

/**
 * Stop pushing for this connection. Best-effort by design: the caller is
 * disconnecting, and a channel Google has already forgotten answers 404, which is
 * the end state we wanted anyway.
 */
export async function stopCalendarPushChannel(
  integration: CalendarIntegration,
  connection: CalendarConnectionRow & { channelId: string | null; resourceId: string | null },
): Promise<boolean> {
  if (!connection.channelId || !connection.resourceId) return false;
  const grant = await refreshAccessToken(
    integration.googleOAuthClient,
    readRefreshToken(integration, connection),
  );
  const result = await stopWatchChannel({
    accessToken: grant.accessToken,
    channelId: connection.channelId,
    resourceId: connection.resourceId,
    fetchImplementation: integration.googleOAuthClient.fetchImplementation,
  });
  return result.stopped;
}
