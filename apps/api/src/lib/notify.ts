import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, isNotNull, ne } from "drizzle-orm";
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
  actorUserId: string,
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
        ne(schema.profileMembers.userId, actorUserId),
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
      actorUserId: notification.actorUserId ?? actorUserId,
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
