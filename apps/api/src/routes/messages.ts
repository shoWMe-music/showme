import { schema } from "@showme/db";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { publishEventMessagePosted } from "../lib/notify";
import {
  type MessageViewer,
  canSeeMessage,
  isOperatorViewer,
  serializeMessage,
} from "../serialize/message";

const EventParams = z.object({ id: z.string().uuid() });

const messageVisibilityEnum = z.enum(["all", "operators", "party"]);

const CreateMessageBody = z.object({
  body: z.string().min(1),
  visibility: messageVisibilityEnum.default("all"),
  attachments: z.unknown().optional(),
});

const MessageResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  senderUserId: z.string(),
  senderParticipantId: z.string().nullable(),
  body: z.string(),
  attachments: z.unknown().nullable(),
  visibility: z.string(),
  createdAt: z.string(),
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

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List an event's messages the caller may see — `event.view`, then filtered
  // by each message's visibility (all / operators / party) server-side.
  app.get(
    "/events/:id/messages",
    { schema: { params: EventParams, response: { 200: z.array(MessageResponse) } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const viewer: MessageViewer = {
        isOperator: isOperatorViewer(capabilities),
        userId: principal.userId,
      };

      const messages = await database
        .select()
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.eventId, eventId))
        .orderBy(asc(schema.eventMessages.createdAt));

      return messages.filter((message) => canSeeMessage(message, viewer)).map(serializeMessage);
    },
  );

  // Post a message — `message.post`, stamped with the sender, audited.
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

      await requireEventCapability(request, eventId, "message.post");
      const senderParticipantId = await resolveSenderParticipantId(request, eventId);
      const body = request.body;

      const created = await database.transaction(async (tx) => {
        const [message] = await tx
          .insert(schema.eventMessages)
          .values({
            eventId,
            senderUserId: principal.userId,
            senderParticipantId,
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
        await publishEventMessagePosted(database, eventId, principal.userId, {
          id: created.id,
          visibility: created.visibility,
        });
      } catch (error) {
        request.log.error({ error, eventId, messageId: created.id }, "message publish failed");
      }

      return reply.status(201).send(serializeMessage(created));
    },
  );
}
