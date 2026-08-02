import { schema } from "@showme/db";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";

const EventParams = z.object({ id: z.string().uuid() });

const UpsertSetlistBody = z.object({ items: z.unknown() });

const SetlistResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  participantId: z.string(),
  items: z.unknown().nullable(),
  updatedAt: z.string(),
});

type SetlistRow = typeof schema.setlists.$inferSelect;

function serializeSetlist(setlist: SetlistRow) {
  return {
    id: setlist.id,
    eventId: setlist.eventId,
    participantId: setlist.participantId,
    items: setlist.items ?? null,
    updatedAt: setlist.updatedAt.toISOString(),
  };
}

/** The `event_participant` ids the caller stands behind on this event (their active memberships). */
async function callerParticipantIds(request: FastifyRequest, eventId: string): Promise<string[]> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id, profileId: schema.eventParticipants.profileId })
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
  return rows.map((row) => row.id);
}

export async function setlistRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List setlists — operators (`budget.view`) see all; a performer sees only their own.
  app.get(
    "/events/:id/setlists",
    { schema: { params: EventParams, response: { 200: z.array(SetlistResponse) } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      const capabilities = await requireEventCapability(request, eventId, "event.view");

      if (capabilities.has("budget.view")) {
        const all = await database
          .select()
          .from(schema.setlists)
          .where(eq(schema.setlists.eventId, eventId));
        return all.map(serializeSetlist);
      }

      const participantIds = await callerParticipantIds(request, eventId);
      if (participantIds.length === 0) return [];
      const own = await database
        .select()
        .from(schema.setlists)
        .where(
          and(
            eq(schema.setlists.eventId, eventId),
            inArray(schema.setlists.participantId, participantIds),
          ),
        );
      return own.map(serializeSetlist);
    },
  );

  // Upsert the CALLER's setlist (keyed by event + their participant). Audit "setlist.update".
  app.put(
    "/events/:id/setlists",
    {
      schema: { params: EventParams, body: UpsertSetlistBody, response: { 200: SetlistResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      await requireEventCapability(request, eventId, "schedule.view");
      const participantIds = await callerParticipantIds(request, eventId);
      const participantId = participantIds[0];
      if (!participantId) throw forbidden("You are not a participant on this event");

      const items = request.body.items ?? null;

      const saved = await database.transaction(async (tx) => {
        const [setlist] = await tx
          .insert(schema.setlists)
          .values({ eventId, participantId, items })
          .onConflictDoUpdate({
            target: [schema.setlists.eventId, schema.setlists.participantId],
            set: { items, updatedAt: new Date() },
          })
          .returning();
        if (!setlist) throw new Error("setlist upsert failed");
        await writeAudit(tx, request, {
          capability: "schedule.view",
          action: "setlist.update",
          targetKind: "setlist",
          targetId: setlist.id,
          eventId,
          after: setlist,
        });
        return setlist;
      });

      return serializeSetlist(saved);
    },
  );
}
