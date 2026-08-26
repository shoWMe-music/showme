import { pushChannelIsLive } from "../lib/calendar-sync";

/**
 * Field-level serialization for a calendar connection — the same half of
 * authorization `serialize/calendar.ts` performs for the entries it imports, and
 * for the same reason.
 *
 * THE RULE: the Google account address is shown only to the person who connected
 * it. Everyone else on the profile is told THAT a calendar feeds this profile's
 * availability, and nothing about whose it is.
 *
 * WHY IT HAS TO BE HERE AND NOT IN THE CLIENT. A connection is profile-scoped by
 * construction — that is what makes its imports occupy the profile's nights — so
 * the row sits inside a payload every member of the profile is entitled to fetch.
 * `daniel@showme.music` is a personal address, and on a venue team it may be a
 * private one; leaving it in the JSON and hiding it in the UI is precisely the
 * client-only-hiding gap this rebuild exists to close. It is the same withholding
 * decision that hides "Founder Lunch" from a co-member, one level up.
 *
 * NOT SERIALIZED AT ALL, at any tier: the sealed refresh token, its nonce, its
 * authentication tag, and the sync token. None of them are useful to a screen and
 * all of them are strictly worse for existing in a response body — the sync token
 * because it lets a holder of the credential enumerate a calendar's history, the
 * other three because they are the credential.
 *
 * WHAT EVERY READER GETS: which profile it feeds, when it last synced, whether the
 * next sync is incremental, and whether it needs reconnecting. All four are facts
 * about the profile's availability, which is the shared thing.
 */

export interface CalendarConnectionFields {
  id: string;
  userId: string;
  profileId: string;
  provider: string;
  providerAccountId: string;
  providerCalendarId: string;
  calendarTimeZone: string | null;
  scope: string;
  syncToken: string | null;
  lastSyncedAt: Date | null;
  lastFullSyncAt: Date | null;
  reauthorizationRequiredAt: Date | null;
  lastError: string | null;
  channelId: string | null;
  channelExpiresAt: Date | null;
  createdAt: Date;
}

export interface SerializedCalendarConnection {
  id: string;
  provider: string;
  profileId: string;
  /** Null when this reader is not the person whose Google account it is. */
  providerAccountId: string | null;
  /** True when the line above was withheld rather than simply unknown. */
  accountWithheld: boolean;
  providerCalendarId: string;
  calendarTimeZone: string | null;
  scope: string;
  lastSyncedAt: string | null;
  lastFullSyncAt: string | null;
  /** A stored cursor exists, so the next sync asks only for what changed. */
  incrementalSyncReady: boolean;
  reauthorizationRequiredAt: string | null;
  lastError: string | null;
  /**
   * Is Google currently PUSHING changes, or does this calendar only move when
   * somebody presses Sync now? A lapsed channel is the failure mode this field
   * exists for: everything looks connected and nothing has updated for a week.
   */
  pushChannelActive: boolean;
  /** When the push channel lapses. Null when none was ever registered. */
  channelExpiresAt: string | null;
  /** May this reader press Sync now or Disconnect? Only the connecting user may. */
  manageable: boolean;
  createdAt: string;
}

export function serializeCalendarConnection(
  connection: CalendarConnectionFields,
  viewerUserId: string,
): SerializedCalendarConnection {
  const owns = connection.userId === viewerUserId;

  return {
    id: connection.id,
    provider: connection.provider,
    profileId: connection.profileId,
    providerAccountId: owns ? connection.providerAccountId : null,
    accountWithheld: !owns,
    providerCalendarId: connection.providerCalendarId,
    calendarTimeZone: connection.calendarTimeZone,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastFullSyncAt: connection.lastFullSyncAt?.toISOString() ?? null,
    incrementalSyncReady: connection.syncToken !== null,
    reauthorizationRequiredAt: connection.reauthorizationRequiredAt?.toISOString() ?? null,
    // The provider's own words for a failure. Shown to the owner only: it is a
    // sentence about somebody's Google account, not about the profile.
    lastError: owns ? connection.lastError : null,
    // Not withheld from co-members: whether a profile's availability updates by
    // itself is a fact about the profile, not about somebody's Google account.
    pushChannelActive: pushChannelIsLive(connection),
    channelExpiresAt: connection.channelExpiresAt?.toISOString() ?? null,
    manageable: owns,
    createdAt: connection.createdAt.toISOString(),
  };
}
