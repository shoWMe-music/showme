import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { publish } from "./publish";

/**
 * The user-facing half of the realtime backbone. A notification is a MATERIALIZED
 * per-user feed row (see `schema.notifications`) — unlike the activity log, whose
 * visibility is resolved at read time. Writing one and publishing it are one act:
 * insert the row so it persists in the feed, then `publish` the same payload onto
 * the recipient's Postgres channel so any connected SSE client sees it live.
 */
export interface NotificationInput {
  /** Free-text kind, e.g. "event.participant_added" — the client keys rendering off it. */
  type: string;
  title?: string;
  body?: string;
  eventId?: string;
  actorUserId?: string;
  actorDisplay?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Deliver `notification` to every ACTIVE, on-platform member of `profileId` except
 * the acting user (you never notify yourself of your own action). For each recipient
 * we persist a `notifications` row and then publish it to their realtime channel.
 *
 * Best-effort by contract: callers wrap this in try/catch so a delivery failure can
 * NEVER break or roll back the primary mutation that triggered it. It runs on the
 * pooled `database` (not the mutation's transaction) so it commits independently.
 */
export async function notifyProfileMembers(
  database: Database,
  profileId: string,
  actorUserId: string | null,
  notification: NotificationInput,
): Promise<void> {
  const members = await database
    .select({ userId: schema.profileMembers.userId })
    .from(schema.profileMembers)
    .where(
      and(
        eq(schema.profileMembers.profileId, profileId),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
        actorUserId ? ne(schema.profileMembers.userId, actorUserId) : undefined,
      ),
    );

  const recipientUserIds = members
    .map((member) => member.userId)
    .filter((userId): userId is string => userId !== null);
  if (recipientUserIds.length === 0) return;

  await database.insert(schema.notifications).values(
    recipientUserIds.map((userId) => ({
      userId,
      type: notification.type,
      title: notification.title ?? null,
      body: notification.body ?? null,
      eventId: notification.eventId ?? null,
      actorUserId: notification.actorUserId ?? actorUserId ?? null,
      actorDisplay: notification.actorDisplay ?? null,
      link: notification.link ?? null,
      metadata: notification.metadata ?? null,
    })),
  );

  for (const userId of recipientUserIds) {
    await publish(database, userId, {
      type: notification.type,
      title: notification.title,
      eventId: notification.eventId,
      link: notification.link,
    });
  }
}

/**
 * Realtime-only nudge to everyone on an event who may see a message, so open
 * clients refetch the thread. Deliberately NOT a `notifications` row: a feed entry
 * per chat line would bury the things that actually need attention. The durable
 * record of a message is the message itself.
 *
 * `operatorsOnly` mirrors `canSeeMessage`: `all` reaches every participant, while
 * `operators`/`party` reach only the managing operators (`host`/`co_host`) — for
 * `party` the sender is the only other reader and they are the actor, who is always
 * excluded. Recipients are narrowed by ROLE rather than by resolving each viewer's
 * capabilities; under-notifying a co-host is a missed refresh, whereas
 * over-notifying would tell a performer that an operators-only note exists.
 *
 * The payload carries ids only — never the body. Message visibility is enforced
 * server-side by `GET /events/:id/messages`, so the client must refetch through it
 * rather than render anything pushed down this channel.
 *
 * Best-effort by contract, exactly like `notifyProfileMembers`: callers wrap it so a
 * delivery failure can never roll back the post that triggered it.
 *
 * Split from the publish loop so the recipient rule — the part with a privacy
 * consequence — is directly assertable without a live LISTEN connection.
 */
export async function messageRecipients(
  database: Database,
  eventId: string,
  actorUserId: string,
  visibility: string,
): Promise<string[]> {
  return eventParticipantRecipients(database, eventId, actorUserId, {
    operatorsOnly: visibility !== "all",
  });
}

/**
 * Active on-platform users participating in `eventId`, minus the actor.
 * `operatorsOnly` narrows to the managing operators (`host`/`co_host`).
 *
 * The base recipient rule for anything event-wide. Note it is deliberately NOT used
 * for deals or settlements: those are party-scoped, and notifying the whole event
 * about them would leak another party's activity (see `dealPartyRecipients`).
 */
export async function eventParticipantRecipients(
  database: Database,
  eventId: string,
  actorUserId: string | null,
  options: { operatorsOnly?: boolean } = {},
): Promise<string[]> {
  const operatorsOnly = options.operatorsOnly ?? false;

  const rows = await database
    .selectDistinct({ userId: schema.profileMembers.userId })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
        actorUserId ? ne(schema.profileMembers.userId, actorUserId) : undefined,
        operatorsOnly ? inArray(schema.eventParticipants.role, ["host", "co_host"]) : undefined,
      ),
    );

  return rows
    .map((row) => row.userId)
    .filter((userId): userId is string => userId !== null)
    .sort();
}

/** Publish the nudge to everyone `messageRecipients` resolves. */
export async function publishEventMessagePosted(
  database: Database,
  eventId: string,
  actorUserId: string,
  message: { id: string; visibility: string },
): Promise<void> {
  const recipients = await messageRecipients(database, eventId, actorUserId, message.visibility);
  for (const userId of recipients) {
    await publish(database, userId, {
      type: "event.message_posted",
      eventId,
      messageId: message.id,
      link: `/events/${eventId}`,
    });
  }
}

/**
 * Active on-platform users who hold a party line on `dealId`, minus the actor.
 *
 * Deals are PARTY-SCOPED (`deal_parties`, kind-agnostic): a shared split shows each
 * performer only their own line, so a deal event must reach its parties — not every
 * profile on the event. The reference app notified the whole event for deal changes,
 * which predates `deal.view.own` and would now tell a performer that another party's
 * terms moved. Walks deal_parties → event_participants → profile_members.
 */
export async function dealPartyRecipients(
  database: Database,
  dealId: string,
  actorUserId: string | null,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ userId: schema.profileMembers.userId })
    .from(schema.dealParties)
    .innerJoin(
      schema.eventParticipants,
      eq(schema.eventParticipants.id, schema.dealParties.participantId),
    )
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.dealParties.dealId, dealId),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
        actorUserId ? ne(schema.profileMembers.userId, actorUserId) : undefined,
      ),
    );

  return rows
    .map((row) => row.userId)
    .filter((userId): userId is string => userId !== null)
    .sort();
}

/**
 * Active on-platform users who hold a settlement on `eventId`, minus the actor.
 *
 * One settlement per participant, so this is "everyone with money in this event"
 * rather than everyone who can see it. Used for finalize, where each party needs to
 * know their own figures are now locked.
 */
export async function settlementRecipients(
  database: Database,
  eventId: string,
  actorUserId: string | null,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ userId: schema.profileMembers.userId })
    .from(schema.settlements)
    .innerJoin(
      schema.eventParticipants,
      eq(schema.eventParticipants.id, schema.settlements.participantId),
    )
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.settlements.eventId, eventId),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
        actorUserId ? ne(schema.profileMembers.userId, actorUserId) : undefined,
      ),
    );

  return rows
    .map((row) => row.userId)
    .filter((userId): userId is string => userId !== null)
    .sort();
}

/**
 * Persist + publish one notification to an explicit set of users. The
 * profile-scoped `notifyProfileMembers` covers "tell this profile's people";
 * this covers the scoped sets above, where recipients are resolved by relationship
 * (deal party, settlement holder) rather than by profile membership.
 *
 * Same best-effort contract: callers wrap it so a delivery failure never rolls back
 * the mutation that triggered it.
 */
export async function notifyUsers(
  database: Database,
  recipientUserIds: readonly string[],
  actorUserId: string | null,
  notification: NotificationInput,
): Promise<void> {
  if (recipientUserIds.length === 0) return;

  await database.insert(schema.notifications).values(
    recipientUserIds.map((userId) => ({
      userId,
      type: notification.type,
      title: notification.title ?? null,
      body: notification.body ?? null,
      eventId: notification.eventId ?? null,
      actorUserId: notification.actorUserId ?? actorUserId ?? null,
      actorDisplay: notification.actorDisplay ?? null,
      link: notification.link ?? null,
      metadata: notification.metadata ?? null,
    })),
  );

  for (const userId of recipientUserIds) {
    await publish(database, userId, {
      type: notification.type,
      title: notification.title,
      eventId: notification.eventId,
      link: notification.link,
    });
  }
}
