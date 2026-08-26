import { schema } from "@showme/db";
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
import { messageRecipients } from "../lib/notify";
import { publish } from "../lib/publish";
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
    // Posting into a room you cannot read is not a feature. The back office is the
    // managing operators' (decisions #4), and nobody else may write into it.
    if (!access.isManagingOperator) throw forbidden("Missing capability: budget.view");
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
      const access = await resolveThreadAccess(request, eventId, capabilities);
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

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const access = await resolveThreadAccess(request, eventId, capabilities);
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

      const capabilities = await requireEventCapability(request, eventId, "message.post");
      const access = await resolveThreadAccess(request, eventId, capabilities);
      const body = request.body;
      const threadParticipantId = resolvePostTarget(
        access,
        body.visibility,
        body.threadParticipantId,
      );
      const senderParticipantId = await resolveSenderParticipantId(request, eventId);

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
        await publishMessagePosted(database, eventId, principal.userId, created);
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
}
