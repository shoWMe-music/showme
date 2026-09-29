import { schema } from "@showme/db";
import { messageRecipients, notifyUsers } from "@showme/db/notify";
import { publish } from "@showme/db/publish";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import {
  type ThreadAccess,
  partyThreadRecipientUserIds,
  resolveThreadAccess,
  threadKey,
} from "../lib/message-threads";
import { type MessageViewer, canSeeMessage, serializeMessage } from "../serialize/message";

const EventParams = z.object({ id: z.string().uuid() });

const messageVisibilityEnum = z.enum(["all", "operators", "party"]);

const ListMessagesQuery = z.object({
  /** Optional thread filter: `all`, `operators`, or `party:<participantId>`. */
  threadKey: z.string().optional(),
});

const CreateMessageBody = z.object({
  body: z.string().min(1),
  visibility: messageVisibilityEnum.default("all"),
  /**
   * Required with `visibility: "party"` — WHOSE thread this goes in. Omitted, it
   * falls back to the caller's own party thread, which is what `party` meant before
   * threads existed, so an existing client keeps working unchanged.
   */
  threadParticipantId: z.string().uuid().optional(),
  attachments: z.unknown().optional(),
});

const MessageResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  senderUserId: z.string(),
  senderParticipantId: z.string().nullable(),
  threadKey: z.string(),
  threadParticipantId: z.string().nullable(),
  body: z.string(),
  attachments: z.unknown().nullable(),
  visibility: z.string(),
  createdAt: z.string(),
});

const ThreadResponse = z.object({
  key: z.string(),
  scope: z.enum(["all", "operators", "party"]),
  participantId: z.string().nullable(),
  title: z.string(),
  /**
   * Everyone who can read this thread, named. The UI renders it verbatim: a thread
   * that looks private but is not is worse than no thread, and story.md is explicit
   * that the operator's broad visibility is emergent from their relationships, not
   * a granted god-mode. So threads are never labelled "private" — they are labelled
   * with exactly who is in them.
   */
  readers: z.array(z.object({ participantId: z.string(), name: z.string(), role: z.string() })),
  messageCount: z.number(),
  lastMessageAt: z.string().nullable(),
  canPost: z.boolean(),
});

/**
 * The caller's participant id on this event, if any — resolved through their
 * active profile memberships joined to the event's participants (the same path
 * `resolveDealViewer` walks). Used to stamp `sender_participant_id` on a post.
 */
async function resolveSenderParticipantId(
  request: FastifyRequest,
  eventId: string,
): Promise<string | null> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const [row] = await request.server.database
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  return row?.id ?? null;
}

/** The viewer shape `canSeeMessage` filters against, from a resolved thread access. */
function viewerFor(access: ThreadAccess): MessageViewer {
  return {
    isOperator: access.isManagingOperator,
    readableThreadParticipantIds: access.readableThreadParticipantIds,
  };
}

/**
 * Which thread a POST is addressed to, refused if the caller is not in it.
 *
 * Not-in-the-thread is a 404, not a 403: the same no-existence-leak rule
 * `requireDealAccess` follows. Learning that a thread exists is already learning
 * that a conversation you are not part of is happening.
 */
function resolvePostTarget(
  access: ThreadAccess,
  visibility: "all" | "operators" | "party",
  requestedParticipantId: string | undefined,
): string | null {
  if (visibility === "all") return null;
  if (visibility === "operators") {
    /*
     * Posting into a room you cannot read is not a feature. The back office is the managing
     * operators' (decisions #4), and nobody else may write into it.
     *
     * The refusal used to read *"Missing capability: budget.view"* — a budget capability named for a
     * messaging action, which told the caller nothing true about why (QA10-10). It also could not be
     * acted on: the reason a co-promoter hit it was not a missing capability at all, it was this gate
     * asking the wrong question.
     */
    if (!access.isManagingOperator) {
      throw forbidden("The operators' room is for the parties running this event");
    }
    return null;
  }

  const target =
    requestedParticipantId ??
    // No thread named: the caller's own. Exactly one counterparty row is the normal
    // case (a performer, a crew person); several is ambiguous and must be explicit.
    (access.readableThreadParticipantIds.size === 1 &&
    access.callerParticipantIds.some((id) => access.readableThreadParticipantIds.has(id))
      ? access.callerParticipantIds.find((id) => access.readableThreadParticipantIds.has(id))
      : undefined);

  if (!target) throw notFound("Thread not found");
  if (!access.readableThreadParticipantIds.has(target)) throw notFound("Thread not found");
  return target;
}

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // The threads the caller may read — the event room, the operators back office if
  // they are one, and every party thread they stand in. Threads with no messages
  // are listed too: a thread is a relationship, not a message bag.
  app.get(
    "/events/:id/message-threads",
    {
      schema: {
        params: EventParams,
        response: { 200: z.object({ items: z.array(ThreadResponse) }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const access = await resolveThreadAccess(request, eventId);
      const canPost = capabilities.has("message.post");

      const messages = await database
        .select({
          visibility: schema.eventMessages.visibility,
          threadParticipantId: schema.eventMessages.threadParticipantId,
          createdAt: schema.eventMessages.createdAt,
        })
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.eventId, eventId));

      const nameOf = new Map(
        access.graph.participants.map((participant) => [participant.id, participant]),
      );

      return {
        items: access.threads.map((thread) => {
          const inThread = messages.filter(
            (message) => threadKey(message.visibility, message.threadParticipantId) === thread.key,
          );
          const lastMessageAt = inThread.reduce<Date | null>(
            (latest, message) =>
              latest == null || message.createdAt > latest ? message.createdAt : latest,
            null,
          );
          return {
            key: thread.key,
            scope: thread.scope,
            participantId: thread.participantId,
            title: thread.title,
            readers: thread.readerParticipantIds.flatMap((participantId) => {
              const participant = nameOf.get(participantId);
              return participant
                ? [{ participantId, name: participant.profileName, role: participant.role }]
                : [];
            }),
            messageCount: inThread.length,
            lastMessageAt: lastMessageAt?.toISOString() ?? null,
            canPost: canPost && (thread.scope !== "operators" || access.isManagingOperator),
          };
        }),
      };
    },
  );

  // List an event's messages the caller may see — `event.view`, then filtered by
  // the thread each message is in, server-side. Still a flat array, so a caller
  // that predates threads keeps working; `threadKey` narrows it to one thread.
  app.get(
    "/events/:id/messages",
    {
      schema: {
        params: EventParams,
        querystring: ListMessagesQuery,
        response: { 200: z.array(MessageResponse) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      // The gate still runs; only its RETURN is unused now that the back office is a role
      // question rather than a capability one (QA10-10).
      await requireEventCapability(request, eventId, "event.view");
      const access = await resolveThreadAccess(request, eventId);
      const viewer = viewerFor(access);

      const messages = await database
        .select()
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.eventId, eventId))
        .orderBy(asc(schema.eventMessages.createdAt));

      const wanted = request.query.threadKey;
      return messages
        .filter((message) => canSeeMessage(message, viewer))
        .filter(
          (message) =>
            wanted == null || threadKey(message.visibility, message.threadParticipantId) === wanted,
        )
        .map(serializeMessage);
    },
  );

  // Post into a thread — `message.post`, plus standing in the thread, audited.
  app.post(
    "/events/:id/messages",
    {
      schema: { params: EventParams, body: CreateMessageBody, response: { 201: MessageResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // The gate still runs; only its RETURN is unused now that the back office is a role
      // question rather than a capability one (QA10-10).
      await requireEventCapability(request, eventId, "message.post");
      const access = await resolveThreadAccess(request, eventId);
      const body = request.body;
      const threadParticipantId = resolvePostTarget(
        access,
        body.visibility,
        body.threadParticipantId,
      );
      const senderParticipantId = await resolveSenderParticipantId(request, eventId);
      /*
       * The night's name, for the bell's title only (QA8-7). Read BEFORE the insert so the
       * notification does not need a second round trip after the commit, and read as its
       * own narrow select rather than through a loader — nothing else on this route needs
       * the event row.
       */
      const [eventForNotice] = await database
        .select({ title: schema.events.title })
        .from(schema.events)
        .where(eq(schema.events.id, eventId));

      const created = await database.transaction(async (tx) => {
        const [message] = await tx
          .insert(schema.eventMessages)
          .values({
            eventId,
            senderUserId: principal.userId,
            senderParticipantId,
            threadParticipantId,
            body: body.body,
            visibility: body.visibility,
            attachments: body.attachments ?? null,
          })
          .returning();
        if (!message) throw new Error("message create failed");
        await writeAudit(tx, request, {
          capability: "message.post",
          action: "message.post",
          targetKind: "event_message",
          targetId: message.id,
          eventId,
          after: message,
        });
        return message;
      });

      // Realtime: tell everyone who may read this message that the thread moved,
      // so open clients refetch. Best-effort — a delivery failure must never undo
      // the post above, so it runs after the commit, off the transaction.
      try {
        await publishMessagePosted(
          database,
          eventId,
          principal.userId,
          created,
          eventForNotice ?? { title: null },
          request.firebaseUser?.name ?? undefined,
        );
      } catch (error) {
        request.log.error({ error, eventId, messageId: created.id }, "message publish failed");
      }

      return reply.status(201).send(serializeMessage(created));
    },
  );
}

/**
 * Nudge the thread's readers over SSE. The recipient set has to mirror the read
 * rule exactly: the payload carries ids only (never the body), so who receives it
 * IS the privacy boundary — over-notifying tells someone a conversation they cannot
 * read is happening, which is the whole thing threads are for.
 *
 * The event room and the back office keep their existing recipient rules
 * (`messageRecipients`); only a party thread needs the graph.
 */
async function publishMessagePosted(
  database: Parameters<typeof messageRecipients>[0],
  eventId: string,
  actorUserId: string,
  message: { id: string; visibility: string; threadParticipantId: string | null },
  /**
   * For the bell's title and the name beside it. Absent on a message posted against an
   * event whose title could not be read, which is not a reason to skip the notification —
   * the reader can still be told there is something to read.
   */
  event: { title: string | null },
  actorDisplay: string | undefined,
): Promise<void> {
  const recipients = message.threadParticipantId
    ? await partyThreadRecipientUserIds(database, eventId, actorUserId, message.threadParticipantId)
    : await messageRecipients(database, eventId, actorUserId, message.visibility);

  const key = threadKey(
    message.visibility as "all" | "operators" | "party",
    message.threadParticipantId,
  );
  for (const userId of recipients) {
    await publish(database, userId, {
      type: "event.message_posted",
      eventId,
      messageId: message.id,
      threadKey: key,
      link: `/events/${eventId}`,
    });
  }

  /*
   * AND THE BELL, for everyone who is not looking at this tab right now (QA8-7).
   *
   * `messages.ts` was the only interactive event route that never wrote a notification —
   * it published the frame above and stopped — so a message reached an open screen and
   * nobody else. `select type, count(*) from notifications` had never held a message row.
   *
   * THE SAME `recipients`, deliberately. The list above mirrors the read rule exactly and
   * its own docstring says why that matters: who receives it IS the privacy boundary. A
   * second recipient rule for the bell is the one mistake available here, and it would be
   * the kind that tells somebody a conversation they cannot read is happening.
   *
   * NO MESSAGE TEXT. The frame carries ids only by design, and a notification row is
   * DURABLE where thread access is not: access is resolved at post time, so a preview
   * stored today can be read after that access is revoked tomorrow. The title names the
   * night, `actorDisplay` names who spoke, and the link opens the thread — enough to act
   * on, nothing to leak.
   *
   * The `message.` prefix puts it under the new "messages" preference category, so the
   * bell can be turned off; email is off by default there (`NOTIFICATION_CATEGORIES`),
   * and no `email` argument is passed, so nothing is sent regardless.
   */
  await notifyUsers(database as Parameters<typeof notifyUsers>[0], recipients, actorUserId, {
    type: "message.posted",
    title: `New message on "${event.title ?? "your event"}"`,
    eventId,
    actorDisplay,
    // BARE, like every other writer and like this route's own realtime twin above. Which TAB a
    // notification opens is `notificationDestination`'s map, keyed on this `type` — stating it in
    // the link as well put the same fact in two places, and the two disagreed (run 13).
    link: `/events/${eventId}`,
  });
}
