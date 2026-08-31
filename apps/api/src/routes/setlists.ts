import { type EventRole, PERFORMING_EVENT_ROLES } from "@showme/auth";
import { schema } from "@showme/db";
import { type SQL, and, asc, eq, inArray, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";

/**
 * Module 5 — setlists (PLAN.md:412; decisions.md "Setlists", RESOLVED).
 *
 * The setlist is the ACT's artistic content: the **performer authors** it, the
 * **operator reports** on it (the PRO filing derived from it), and **crew are not
 * a core consumer** — a lighting operator on a cued show gets it only when the
 * performer *shares* it to that participant. Authoring is therefore gated on its
 * own `setlist.author` capability (the performer preset + the performer floor,
 * including the DELEGATED floor — an agent carries business authority, never the
 * songs), never on `schedule.view`, which every participant on the event holds.
 */

const EventParams = z.object({ id: z.string().uuid() });
const SetlistParams = z.object({ id: z.string().uuid(), setlistId: z.string().uuid() });
const SetlistShareParams = z.object({
  id: z.string().uuid(),
  setlistId: z.string().uuid(),
  participantId: z.string().uuid(),
});

const UpsertSetlistBody = z.object({ items: z.unknown() });
const CreateSetlistShareBody = z.object({ participantId: z.string().uuid() });

const SetlistResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  participantId: z.string(),
  /**
   * The act that wrote it, from the participant's PROFILE — the same join
   * `performance-reports.ts` makes to keep a support slot's songs from being
   * filed under the headliner. Resolved here so a reader who is shown several
   * acts' sets (the operator on the event workspace) does not have to fetch the
   * roster and re-derive the answer.
   */
  performerName: z.string().nullable(),
  /**
   * Whether the caller stands behind this setlist's participant row — i.e.
   * whether it is theirs to edit.
   *
   * Server-computed on purpose. A client could try to guess it by matching the
   * roster against its own memberships, and would have to hold the whole roster
   * to do it; "is this yours" is a fact about the caller's standing, which is
   * the serializer's job (`.claude/skills/authorization`), not the screen's.
   */
  mine: z.boolean(),
  items: z.unknown().nullable(),
  updatedAt: z.string(),
});

const SetlistShareResponse = z.object({
  id: z.string(),
  setlistId: z.string(),
  participantId: z.string(),
  createdAt: z.string(),
});

type SetlistRow = typeof schema.setlists.$inferSelect;
type SetlistShareRow = typeof schema.setlistShares.$inferSelect;

function serializeSetlist(
  setlist: SetlistRow,
  performerName: string | null,
  ownParticipantIds: readonly string[],
) {
  return {
    id: setlist.id,
    eventId: setlist.eventId,
    participantId: setlist.participantId,
    performerName: performerName?.trim() || null,
    mine: ownParticipantIds.includes(setlist.participantId),
    items: setlist.items ?? null,
    updatedAt: setlist.updatedAt.toISOString(),
  };
}

function serializeSetlistShare(share: SetlistShareRow) {
  return {
    id: share.id,
    setlistId: share.setlistId,
    participantId: share.participantId,
    createdAt: share.createdAt.toISOString(),
  };
}

/** One participant row the caller stands behind, with what it is and who it is. */
interface CallerParticipant {
  readonly id: string;
  readonly role: EventRole;
  readonly profileName: string | null;
}

/**
 * Every `event_participant` the caller stands behind on this event, through
 * their active memberships. A user can hold SEVERAL — a promoter who also plays
 * brings an operator profile and a performer profile to the same night — which
 * is why this is a list and why the writes below have to say which of them they
 * mean.
 */
async function callerParticipants(
  request: FastifyRequest,
  eventId: string,
): Promise<CallerParticipant[]> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  return await request.server.database
    .select({
      id: schema.eventParticipants.id,
      role: schema.eventParticipants.role,
      profileName: schema.profiles.name,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
}

/** One setlist plus the act behind it — the shape every read here returns. */
interface SetlistWithAct {
  readonly setlist: SetlistRow;
  readonly performerName: string | null;
}

/**
 * Setlists on an event, each carrying the name of the PROFILE behind its
 * participant, ordered by that name so the list is stable between reads. Same
 * join as `performance-reports.ts`: the participant's `performer_tag` holds the
 * slot ("headliner"), not the artist.
 */
async function loadSetlists(
  request: FastifyRequest,
  eventId: string,
  restriction?: SQL,
): Promise<SetlistWithAct[]> {
  const rows = await request.server.database
    .select({ setlist: schema.setlists, performerName: schema.profiles.name })
    .from(schema.setlists)
    .innerJoin(
      schema.eventParticipants,
      eq(schema.eventParticipants.id, schema.setlists.participantId),
    )
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(
      restriction
        ? and(eq(schema.setlists.eventId, eventId), restriction)
        : eq(schema.setlists.eventId, eventId),
    )
    .orderBy(asc(schema.profiles.name));
  return rows;
}

/**
 * Load a setlist the caller AUTHORED — the only standing from which it may be
 * shared or unshared. Missing (or on another event) is 404; someone else's is 403.
 */
async function requireAuthoredSetlist(
  request: FastifyRequest,
  eventId: string,
  setlistId: string,
): Promise<SetlistRow> {
  const [setlist] = await request.server.database
    .select()
    .from(schema.setlists)
    .where(and(eq(schema.setlists.id, setlistId), eq(schema.setlists.eventId, eventId)));
  if (!setlist) throw notFound("Setlist not found");

  const participants = await callerParticipants(request, eventId);
  if (!participants.some((participant) => participant.id === setlist.participantId)) {
    throw forbidden("Only the performer who authored the setlist may share it");
  }
  return setlist;
}

export async function setlistRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * List setlists on an event.
   *
   * THREE STANDINGS, and each one is a different claim:
   *   · the FILING operator (`performance_report.file`) sees every act's set,
   *     because the performed-works report they owe the society is derived from
   *     all of them (decisions.md "Setlists"; `performing-rights.ts`);
   *   · the ACT sees its own — the inviolable slice of story.md; and
   *   · anyone else sees only what was explicitly SHARED to one of their
   *     participant rows, which is the lighting operator's one legitimate door.
   *
   * The operator's gate used to be `budget.view`, which is the same "read a
   * money capability as a stand-in for *is an operator*" shortcut that
   * `presets.ts` records fixing for `rider.view`. It is wrong for a reason that
   * shows up the moment a co-promoter is handed the sheet and nothing else:
   * seeing the pool is a claim on the money, never on the act's songs. The
   * capability that IS the claim is the filing, and the ceiling already keeps it
   * to the managing operators.
   */
  app.get(
    "/events/:id/setlists",
    { schema: { params: EventParams, response: { 200: z.array(SetlistResponse) } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const participants = await callerParticipants(request, eventId);
      const participantIds = participants.map((participant) => participant.id);

      if (capabilities.has("performance_report.file")) {
        const all = await loadSetlists(request, eventId);
        return all.map((row) => serializeSetlist(row.setlist, row.performerName, participantIds));
      }

      if (participantIds.length === 0) return [];

      const shares = await database
        .select({ setlistId: schema.setlistShares.setlistId })
        .from(schema.setlistShares)
        .where(inArray(schema.setlistShares.participantId, participantIds));
      const sharedSetlistIds = shares.map((share) => share.setlistId);

      const ownOrShared = await loadSetlists(
        request,
        eventId,
        sharedSetlistIds.length > 0
          ? or(
              inArray(schema.setlists.participantId, participantIds),
              inArray(schema.setlists.id, sharedSetlistIds),
            )
          : inArray(schema.setlists.participantId, participantIds),
      );
      return ownOrShared.map((row) =>
        serializeSetlist(row.setlist, row.performerName, participantIds),
      );
    },
  );

  // Upsert the CALLER's setlist (keyed by event + their participant). Only the act
  // authors: `setlist.author`, never `schedule.view`. Audit "setlist.update".
  app.put(
    "/events/:id/setlists",
    {
      schema: { params: EventParams, body: UpsertSetlistBody, response: { 200: SetlistResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      await requireEventCapability(request, eventId, "setlist.author");
      // WHICH of the caller's rows the songs hang on. One user can stand behind
      // several participants on one night — a promoter who also plays — and the
      // capability engine unions across all of them, so holding `setlist.author`
      // says nothing about which row is the act. Taking whichever row the
      // database returned first could attach the set to the HOST participant,
      // and `performance-reports.ts` names each set by joining the participant to
      // its profile: the songs would reach the society under the venue's name.
      const participants = await callerParticipants(request, eventId);
      const author =
        participants.find((participant) => PERFORMING_EVENT_ROLES.has(participant.role)) ??
        participants[0];
      if (!author) throw forbidden("You are not a participant on this event");
      const participantId = author.id;

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
          capability: "setlist.author",
          action: "setlist.update",
          targetKind: "setlist",
          targetId: setlist.id,
          eventId,
          after: setlist,
        });
        // Participant-scoped on the AUTHOR's participant row: the setlist is the
        // act's own artistic content (decisions.md "Setlists"), and the read route
        // shows it to its author, to the operators who file the PRO report, and to
        // whoever it was explicitly shared with. The count of songs is the only
        // number here — the titles are the content itself.
        await writeActivity(tx, request, {
          eventId,
          type: "setlist.updated",
          targetKind: "setlist",
          targetId: participantId,
          summary: {
            setlistId: setlist.id,
            itemCount: Array.isArray(items) ? items.length : 0,
          },
        });
        return setlist;
      });

      return serializeSetlist(saved, author.profileName, [participantId]);
    },
  );

  // Who the caller's own setlist is shared with. Author-only — the grant list is
  // the performer's, not the event's.
  app.get(
    "/events/:id/setlists/:setlistId/shares",
    { schema: { params: SetlistParams, response: { 200: z.array(SetlistShareResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id: eventId, setlistId } = request.params;

      await requireEventCapability(request, eventId, "setlist.author");
      await requireAuthoredSetlist(request, eventId, setlistId);

      const shares = await database
        .select()
        .from(schema.setlistShares)
        .where(eq(schema.setlistShares.setlistId, setlistId));
      return shares.map(serializeSetlistShare);
    },
  );

  // Share the caller's own setlist with one other participant ON THE SAME EVENT —
  // the crew's ONLY legitimate access (decisions.md "Setlists"). Read access only;
  // never a write grant. Idempotent. Audit "setlist.share".
  app.post(
    "/events/:id/setlists/:setlistId/shares",
    {
      schema: {
        params: SetlistParams,
        body: CreateSetlistShareBody,
        response: { 201: SetlistShareResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id: eventId, setlistId } = request.params;
      const { participantId } = request.body;

      await requireEventCapability(request, eventId, "setlist.author");
      const setlist = await requireAuthoredSetlist(request, eventId, setlistId);

      // The recipient must stand on THIS event — a share is an event-scoped grant,
      // so a participant from another event is a bad request, not a 404 hunt.
      const [recipient] = await database
        .select({ id: schema.eventParticipants.id })
        .from(schema.eventParticipants)
        .where(
          and(
            eq(schema.eventParticipants.id, participantId),
            eq(schema.eventParticipants.eventId, eventId),
            ne(schema.eventParticipants.status, "removed"),
          ),
        );
      if (!recipient) throw badRequest("That participant is not on this event");

      const share = await database.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.setlistShares)
          .values({ setlistId, participantId })
          .onConflictDoNothing({
            target: [schema.setlistShares.setlistId, schema.setlistShares.participantId],
          })
          .returning();
        if (!inserted) {
          // Already shared — the grant is idempotent, so return the standing row.
          const [existing] = await tx
            .select()
            .from(schema.setlistShares)
            .where(
              and(
                eq(schema.setlistShares.setlistId, setlistId),
                eq(schema.setlistShares.participantId, participantId),
              ),
            );
          if (!existing) throw new Error("setlist share insert failed");
          return existing;
        }
        await writeAudit(tx, request, {
          capability: "setlist.author",
          action: "setlist.share",
          targetKind: "setlist",
          targetId: setlistId,
          eventId,
          after: { participantId },
        });
        // A read grant on the act's own content — who may open it, and when it was
        // opened to them. Scoped to the AUTHOR's participant row (plus the
        // operators), so it reads as "you shared this", never as somebody else's
        // setlist appearing in a stranger's timeline.
        await writeActivity(tx, request, {
          eventId,
          type: "setlist.shared",
          targetKind: "setlist",
          targetId: setlist.participantId,
          summary: { setlistId, withParticipantId: participantId },
        });
        return inserted;
      });

      return reply.status(201).send(serializeSetlistShare(share));
    },
  );

  // Revoke a share. Author-only, idempotent-ish: an unknown grant is a 404.
  // Audit "setlist.unshare".
  app.delete(
    "/events/:id/setlists/:setlistId/shares/:participantId",
    { schema: { params: SetlistShareParams } },
    async (request, reply) => {
      const { database } = request.server;
      const { id: eventId, setlistId, participantId } = request.params;

      await requireEventCapability(request, eventId, "setlist.author");
      const setlist = await requireAuthoredSetlist(request, eventId, setlistId);

      const [existing] = await database
        .select()
        .from(schema.setlistShares)
        .where(
          and(
            eq(schema.setlistShares.setlistId, setlistId),
            eq(schema.setlistShares.participantId, participantId),
          ),
        );
      if (!existing) throw notFound("Setlist share not found");

      await database.transaction(async (tx) => {
        await tx.delete(schema.setlistShares).where(eq(schema.setlistShares.id, existing.id));
        await writeActivity(tx, request, {
          eventId,
          type: "setlist.unshared",
          targetKind: "setlist",
          targetId: setlist.participantId,
          summary: { setlistId, withParticipantId: participantId },
        });
        await writeAudit(tx, request, {
          capability: "setlist.author",
          action: "setlist.unshare",
          targetKind: "setlist",
          targetId: setlistId,
          eventId,
          before: existing,
        });
      });

      return reply.status(204).send();
    },
  );
}
