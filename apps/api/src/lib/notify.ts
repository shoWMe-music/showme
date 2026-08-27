import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { EmailSink } from "./email";
import type { RenderedEmail } from "./email-templates";
import { publish } from "./publish";

/**
 * WHAT A PERSON IS ALLOWED TO HAVE AN OPINION ABOUT.
 *
 * Not invented: every key below is a grouping of `type` strings the app already
 * emits, which is why there is no `tasks` category — nothing writes a `task.*`
 * notification yet, and a switch for a thing that never happens is a lie in the
 * settings screen. Add the category in the same change that adds the emitter.
 *
 * `emailDefault` is the deliberate half. The rule it follows: EMAIL IS ON WHERE
 * NOT SEEING IT COSTS MONEY OR A DATE, and off where the notification is only
 * situational awareness. A booking request nobody answers is lost business; a
 * hold you did not know you lost is a night gone; a deal or a settlement moving
 * is somebody's money. Being added to an event is none of those — it is news you
 * get the next time you open the app, and mailing it is how a product teaches
 * people to filter its mail, taking the four that matter down with it.
 *
 * `inApp` defaults ON everywhere. The bell is the app's own surface; a user who
 * has expressed no preference expects it to work.
 */
export const NOTIFICATION_CATEGORIES = [
  {
    key: "bookings",
    label: "Booking requests and offers",
    description: "Someone asks you to play, or answers a request you sent.",
    emailDefault: true,
  },
  {
    key: "holds",
    label: "Holds on your dates",
    description: "A hold you are on is confirmed, or lost to a higher rank.",
    emailDefault: true,
  },
  {
    key: "deals",
    label: "Deals and agreements",
    description: "An agreement you are a party to is sent, confirmed or reopened.",
    emailDefault: true,
  },
  {
    key: "settlements",
    label: "Settlements and payouts",
    description:
      "A settlement you are a party to is commented on, signed off or finalized. The review request itself always reaches you — it is the settlement being served, not news about it.",
    emailDefault: true,
  },
  {
    key: "events",
    label: "Events and invitations",
    description: "You are added to an event, or an invitation you sent is answered.",
    emailDefault: false,
  },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map(
  (category) => category.key,
) as readonly NotificationCategory[];

/** The prefix before the dot in a `type` — the only part that carries the subject. */
const CATEGORY_BY_TYPE_PREFIX: Record<string, NotificationCategory> = {
  booking_request: "bookings",
  offer: "bookings",
  hold: "holds",
  deal: "deals",
  settlement: "settlements",
  event: "events",
  invitation: "events",
};

/**
 * Which category governs this notification `type`, or `null` when nothing does.
 *
 * NULL MEANS DELIVER. A type nobody has classified is a type no user was ever
 * shown a switch for, so suppressing it would silence a message on the strength
 * of a preference that was never expressed. The failure direction is deliberate:
 * an uncategorised notification is noisy, an uncategorised notification that is
 * dropped is invisible, and only one of those can be noticed and fixed.
 */
export function categoryForNotificationType(type: string): NotificationCategory | null {
  const prefix = type.split(".")[0];
  if (!prefix) return null;
  return CATEGORY_BY_TYPE_PREFIX[prefix] ?? null;
}

/**
 * What this channel does for someone who has never touched the switch. Exported
 * because the settings route has to render the same answer the delivery path
 * applies — two copies of "in-app defaults on" is how a screen ends up showing a
 * switch in a position nothing agrees with.
 */
export function notificationChannelDefault(
  category: NotificationCategory,
  channel: "inApp" | "email",
): boolean {
  if (channel === "inApp") return true;
  return NOTIFICATION_CATEGORIES.find((entry) => entry.key === category)?.emailDefault ?? true;
}

/**
 * Narrow `userIds` to the ones who still want this `type` on this channel.
 *
 * A stored row is an explicit answer; a missing row is the catalog default. Both
 * halves matter — reading only stored rows would silence everybody who has never
 * opened the settings screen, which is everybody.
 */
async function recipientsAllowing(
  database: Database,
  userIds: readonly string[],
  type: string,
  channel: "inApp" | "email",
): Promise<string[]> {
  const category = categoryForNotificationType(type);
  if (category === null || userIds.length === 0) return [...userIds];

  const stored = await database
    .select({
      userId: schema.notificationPreferences.userId,
      inApp: schema.notificationPreferences.inApp,
      email: schema.notificationPreferences.email,
    })
    .from(schema.notificationPreferences)
    .where(
      and(
        inArray(schema.notificationPreferences.userId, [...userIds]),
        eq(schema.notificationPreferences.category, category),
      ),
    );

  const answers = new Map(stored.map((row) => [row.userId, row]));
  return userIds.filter((userId) => {
    const answer = answers.get(userId);
    if (!answer) return notificationChannelDefault(category, channel);
    return channel === "inApp" ? answer.inApp : answer.email;
  });
}

/**
 * The mail half of a delivery. Optional on every notify call: a caller that
 * passes nothing sends nothing, which is exactly what every existing emitter did
 * before this argument existed.
 *
 * The message is rendered ONCE by the caller and sent to each allowed recipient,
 * so it must not contain anything party-scoped — the same rule the templates
 * already follow (`email-templates.ts`: no money in the mail, the link goes to
 * the screen that can scope what it shows).
 */
export interface NotificationEmail {
  sink: EmailSink;
  message: RenderedEmail;
}

/**
 * Send `email.message` to every recipient whose EMAIL channel allows this type.
 *
 * Per-recipient try/catch: one bad address must not cost the rest their mail, and
 * no failure here may reach the caller — this is inside the best-effort contract.
 */
async function deliverEmail(
  database: Database,
  recipientUserIds: readonly string[],
  type: string,
  email: NotificationEmail,
): Promise<void> {
  const allowed = await recipientsAllowing(database, recipientUserIds, type, "email");
  if (allowed.length === 0) return;

  const addresses = await database
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, allowed));

  for (const row of addresses) {
    if (!row.email) continue;
    try {
      await email.sink.sendEmail({ to: row.email, ...email.message });
    } catch {
      // Swallowed on purpose — see the contract above. The sink itself logs.
    }
  }
}

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
 *
 * Recipients are filtered by each one's notification preferences — see `notifyUsers`,
 * which this delegates the delivery to.
 */
export async function notifyProfileMembers(
  database: Database,
  profileId: string,
  actorUserId: string | null,
  notification: NotificationInput,
  email?: NotificationEmail,
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

  await notifyUsers(database, recipientUserIds, actorUserId, notification, email);
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
 *
 * THE PREFERENCE GATE LIVES HERE, so every emitter in the app is covered by the
 * one it already calls — a route cannot forget to honour a preference, because
 * honouring it is not a thing a route does. `in_app = false` means NO ROW IS
 * WRITTEN: a suppressed notification does not exist, rather than sitting unread
 * forever and surfacing the day the user changes their mind about a fact that has
 * long since stopped being true.
 *
 * `email` is optional and independent — it is offered to the same recipients,
 * filtered by the OTHER channel of the same preference, so a user can keep the
 * bell and drop the mail (or the reverse) without either decision touching the
 * other.
 */
export async function notifyUsers(
  database: Database,
  recipientUserIds: readonly string[],
  actorUserId: string | null,
  notification: NotificationInput,
  email?: NotificationEmail,
): Promise<void> {
  if (recipientUserIds.length === 0) return;

  if (email) await deliverEmail(database, recipientUserIds, notification.type, email);

  const inAppRecipients = await recipientsAllowing(
    database,
    recipientUserIds,
    notification.type,
    "inApp",
  );
  if (inAppRecipients.length === 0) return;

  await database.insert(schema.notifications).values(
    inAppRecipients.map((userId) => ({
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

  // The same narrowed set the rows were written for. Publishing to somebody who was
  // filtered out would push a frame their client answers by refetching a feed the
  // notification is not in — a badge that flickers and then disagrees with itself.
  for (const userId of inAppRecipients) {
    await publish(database, userId, {
      type: notification.type,
      title: notification.title,
      eventId: notification.eventId,
      link: notification.link,
    });
  }
}

/**
 * WHO CAN BE REACHED about this event's settlement, and how.
 *
 * The review step has two halves and they are not the same job. A party with an
 * account gets a notification in the app and a mail to the address on their
 * account — nothing to arrange, it just goes. A party WITHOUT one cannot be
 * notified at all: there is no user row to hang a notification on and no address
 * anybody has recorded. Somebody has to say where to send it, and that somebody
 * is the operator.
 *
 * So this answers, per settlement party: is there a reachable account behind it?
 * `emails` is every verified address that would receive the review mail; empty
 * means the party is off-platform and needs an address assigned before the
 * settlement can reach them.
 *
 * Deliberately keyed on `settlements`, not on participants: a party with no
 * settlement row has nothing to review, and listing them would put a "waiting on
 * an email" prompt beside somebody who is owed nothing.
 */
export interface SettlementPartyReach {
  participantId: string;
  /** Verified account addresses behind this party. Empty ⇒ off-platform. */
  emails: string[];
  /** The user ids to notify in-app. Empty ⇒ nothing to notify. */
  userIds: string[];
}

export async function settlementPartyReach(
  database: Database,
  eventId: string,
): Promise<Map<string, SettlementPartyReach>> {
  const rows = await database
    .select({
      participantId: schema.settlements.participantId,
      userId: schema.profileMembers.userId,
      email: schema.users.email,
    })
    .from(schema.settlements)
    .innerJoin(
      schema.eventParticipants,
      eq(schema.eventParticipants.id, schema.settlements.participantId),
    )
    .leftJoin(
      schema.profileMembers,
      and(
        eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
      ),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.profileMembers.userId))
    .where(eq(schema.settlements.eventId, eventId));

  const reach = new Map<string, SettlementPartyReach>();
  for (const row of rows) {
    if (!row.participantId) continue;
    const entry = reach.get(row.participantId) ?? {
      participantId: row.participantId,
      emails: [],
      userIds: [],
    };
    if (row.userId && !entry.userIds.includes(row.userId)) entry.userIds.push(row.userId);
    if (row.email && !entry.emails.includes(row.email)) entry.emails.push(row.email);
    reach.set(row.participantId, entry);
  }
  return reach;
}
