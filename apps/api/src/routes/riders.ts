import { liveEventDelegations } from "@showme/auth";
import { type Database, schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability, requireProfileRole } from "../lib/authorize";

const ProfileParams = z.object({ id: z.string().uuid() });
const EventParams = z.object({ id: z.string().uuid() });
const EventRiderParams = z.object({ id: z.string().uuid(), rid: z.string().uuid() });

const riderTypeEnum = z.enum(["tech", "hospitality", "stage_plot", "input_list"]);

/** Any profile member may read the library; owner/admin/editor may add to it. */
const LIBRARY_READ_ROLES = ["owner", "admin", "editor", "viewer", "crew"] as const;
const LIBRARY_WRITE_ROLES = ["owner", "admin", "editor"] as const;

const CreateLibraryRiderBody = z.object({
  type: riderTypeEnum,
  name: z.string().min(1),
  description: z.string().optional(),
  fileId: z.string().uuid().optional(),
  isDefault: z.boolean().optional(),
});

const AttachRiderBody = z.object({ sourceRiderId: z.string().uuid() });

const RiderResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string().nullable(),
  eventId: z.string().nullable(),
  ownerParticipantId: z.string().nullable(),
  type: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  fileId: z.string().nullable(),
  sourceRiderId: z.string().nullable(),
  isDefault: z.boolean(),
});

type RiderRow = typeof schema.riders.$inferSelect;

/** Project a rider row onto the wire shape (no serializer tiers — riders aren't refined). */
function serializeRider(rider: RiderRow) {
  return {
    id: rider.id,
    ownerProfileId: rider.ownerProfileId,
    eventId: rider.eventId,
    ownerParticipantId: rider.ownerParticipantId,
    type: rider.type,
    name: rider.name,
    description: rider.description,
    fileId: rider.fileId,
    sourceRiderId: rider.sourceRiderId,
    isDefault: rider.isDefault,
  };
}

/**
 * The caller's `event_participant` on this event — the profile they stand behind.
 * Prefers the acting profile; else the first joined participation. Used to stamp
 * `owner_participant_id` on an attached instance.
 */
async function resolveCallerParticipant(
  request: FastifyRequest,
  eventId: string,
): Promise<{ id: string; profileId: string }> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const rows = await request.server.database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
    })
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
  const preferred = rows.find((row) => row.profileId === principal.actingProfileId);
  const participant = preferred ?? rows[0];
  if (!participant) throw forbidden("You are not a participant on this event");
  return participant;
}

const CREW_ROLES = new Set(["crew", "crew_lead"]);
const OPERATOR_ROLES = new Set(["host", "co_host"]);

/** "all" event riders, or the set of `owner_participant_id`s in a participant's reach. */
type RiderScope = "all" | Set<string>;

/**
 * The rider reach of ONE participant, structurally (decisions #12) — role-agnostic,
 * so ANYONE can sponsor crew and the crew inherits exactly that sponsor's reach:
 *   operator → all; performer/support → their own; agent → the performers they
 *   represent; crew/crew_lead → their sponsor's reach (recursively, cycle-guarded).
 * A grantor therefore can never expose a rider beyond their own domain.
 */
async function participantRiderDomain(
  database: Database,
  eventId: string,
  participantId: string,
  visited: Set<string>,
): Promise<RiderScope> {
  if (visited.has(participantId)) return new Set();
  visited.add(participantId);

  const [participant] = await database
    .select({
      id: schema.eventParticipants.id,
      role: schema.eventParticipants.role,
      profileId: schema.eventParticipants.profileId,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.id, participantId));
  if (!participant) return new Set();

  if (OPERATOR_ROLES.has(participant.role)) return "all";
  if (participant.role === "performer" || participant.role === "support") {
    return new Set([participant.id]);
  }
  if (participant.role === "agent") {
    // The performers this agent represents ON this event — resolved against the
    // representation, not the delegation stamp alone. The stamp outlives an
    // effective-dated termination until the sweep clears it, and a lapsed agreement
    // must not still open its performer's rider (A-19 follow-up).
    const represented = await liveEventDelegations(database, eventId);
    return new Set(
      represented
        .filter((delegation) => delegation.agentProfileId === participant.profileId)
        .map((delegation) => delegation.performerParticipantId),
    );
  }
  if (CREW_ROLES.has(participant.role)) {
    const sponsorId = (participant.details as { sponsorParticipantId?: string } | null)
      ?.sponsorParticipantId;
    return sponsorId
      ? participantRiderDomain(database, eventId, sponsorId, visited)
      : new Set([participant.id]);
  }
  return new Set();
}

/**
 * The event riders the caller may see (decisions #12). Their own reach (operator →
 * all, performer → own, agent → represented) is intrinsic; a CREW participation only
 * contributes its sponsor's reach once the caller holds `rider.view` — the on/off,
 * with the sponsor setting the scope.
 */
async function scopedEventRiders(
  request: FastifyRequest,
  eventId: string,
  capabilities: Set<Capability>,
): Promise<RiderRow[]> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const all = await database.select().from(schema.riders).where(eq(schema.riders.eventId, eventId));
  if (capabilities.has("budget.view")) return all; // operators see everything

  const mine = await database
    .select({
      id: schema.eventParticipants.id,
      role: schema.eventParticipants.role,
      details: schema.eventParticipants.details,
    })
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
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const hasRiderView = capabilities.has("rider.view");
  const visibleOwners = new Set<string>();
  for (const participant of mine) {
    visibleOwners.add(participant.id); // your own rider, always
    // Crew reach is opt-in; everyone else's reach (own/represented) is intrinsic.
    if (CREW_ROLES.has(participant.role) && !hasRiderView) continue;
    const sponsorId = CREW_ROLES.has(participant.role)
      ? (participant.details as { sponsorParticipantId?: string } | null)?.sponsorParticipantId
      : participant.id;
    if (!sponsorId) continue;
    const domain = await participantRiderDomain(database, eventId, sponsorId, new Set());
    if (domain === "all") return all;
    for (const ownerId of domain) visibleOwners.add(ownerId);
  }

  return all.filter(
    (rider) => rider.ownerParticipantId != null && visibleOwners.has(rider.ownerParticipantId),
  );
}

/**
 * May the caller read the BYTES behind `fileId` because a rider they can see
 * points at it? The rider row is the thing whose visibility is designed
 * (decisions #12, `scopedEventRiders` above); the file underneath it inherits
 * that answer, and must not be authorized on its own weaker terms.
 *
 * Without this, `/files/:id/download-url` asked only "are you a member of the
 * profile that owns this file", which gets a rider exactly backwards in both
 * directions: the OPERATOR the rider was submitted TO could see the row and its
 * `fileId` but never fetch the PDF, while the rule that decides who may see a
 * rider at all — the sponsor-scoped one — was not consulted anywhere.
 *
 * Deliberately a widening only: a caller who fails here still falls back to
 * ownership/membership, so this can never take access away.
 */
export async function riderFileVisibleToCaller(
  request: FastifyRequest,
  fileId: string,
): Promise<boolean> {
  const { database } = request.server;
  const referencing = await database
    .select({ id: schema.riders.id, eventId: schema.riders.eventId })
    .from(schema.riders)
    .where(eq(schema.riders.fileId, fileId));

  for (const rider of referencing) {
    if (!rider.eventId) continue; // library rider — ownership/membership decides
    const capabilities = await eventCapabilities(request, rider.eventId);
    if (!capabilities.has("event.view")) continue;
    const visible = await scopedEventRiders(request, rider.eventId, capabilities);
    if (visible.some((row) => row.id === rider.id)) return true;
  }
  return false;
}

export async function riderRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // A profile's LIBRARY riders (event_id NULL). Any member may read.
  app.get(
    "/profiles/:id/riders",
    { schema: { params: ProfileParams, response: { 200: z.array(RiderResponse) } } },
    async (request) => {
      const profileId = request.params.id;
      requireProfileRole(request, profileId, [...LIBRARY_READ_ROLES]);
      const riders = await request.server.database
        .select()
        .from(schema.riders)
        .where(and(eq(schema.riders.ownerProfileId, profileId), isNull(schema.riders.eventId)));
      return riders.map(serializeRider);
    },
  );

  // Create a LIBRARY rider (owner/admin/editor). Audit "rider.create".
  app.post(
    "/profiles/:id/riders",
    {
      schema: {
        params: ProfileParams,
        body: CreateLibraryRiderBody,
        response: { 201: RiderResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const profileId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      requireProfileRole(request, profileId, [...LIBRARY_WRITE_ROLES]);

      const created = await database.transaction(async (tx) => {
        const [rider] = await tx
          .insert(schema.riders)
          .values({
            ownerProfileId: profileId,
            eventId: null,
            type: request.body.type,
            name: request.body.name,
            description: request.body.description,
            fileId: request.body.fileId,
            isDefault: request.body.isDefault ?? false,
            createdBy: principal.userId,
          })
          .returning();
        if (!rider) throw new Error("rider create failed");
        await writeAudit(tx, request, {
          capability: "rider.submit",
          action: "rider.create",
          targetKind: "rider",
          targetId: rider.id,
          after: rider,
        });
        return rider;
      });

      return reply.status(201).send(serializeRider(created));
    },
  );

  // ATTACH: copy a library rider into an event instance (`rider.submit`). Audit "rider.attach".
  app.post(
    "/events/:id/riders",
    { schema: { params: EventParams, body: AttachRiderBody, response: { 201: RiderResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, eventId, "rider.submit");
      const participant = await resolveCallerParticipant(request, eventId);

      const [source] = await database
        .select()
        .from(schema.riders)
        .where(eq(schema.riders.id, request.body.sourceRiderId));
      if (!source) throw notFound("Rider not found");

      const created = await database.transaction(async (tx) => {
        const [instance] = await tx
          .insert(schema.riders)
          .values({
            eventId,
            ownerParticipantId: participant.id,
            sourceRiderId: source.id,
            type: source.type,
            name: source.name,
            description: source.description,
            fileId: source.fileId,
            createdBy: principal.userId,
          })
          .returning();
        if (!instance) throw new Error("rider attach failed");
        await writeAudit(tx, request, {
          capability: "rider.submit",
          action: "rider.attach",
          targetKind: "rider",
          targetId: instance.id,
          eventId,
          after: instance,
        });
        return instance;
      });

      return reply.status(201).send(serializeRider(created));
    },
  );

  // An event's rider INSTANCES — riders are SENSITIVE, so the set is SCOPED by the
  // caller (decisions #12): an operator (pool visibility) sees all; a performer sees
  // their own; a crew member sees nothing unless granted `rider.view`, and then only
  // within their SPONSOR's reach (operator-sponsored → all; performer-sponsored →
  // that performer's own). `rider.view` is the on/off; the sponsor sets the scope,
  // so a grantor can never leak beyond what they themselves hold.
  app.get(
    "/events/:id/riders",
    { schema: { params: EventParams, response: { 200: z.array(RiderResponse) } } },
    async (request) => {
      const eventId = request.params.id;
      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const riders = await scopedEventRiders(request, eventId, capabilities);
      return riders.map(serializeRider);
    },
  );

  // Remove an event instance — `rider.submit`, and only the caller's own instance.
  app.delete(
    "/events/:id/riders/:rid",
    { schema: { params: EventRiderParams } },
    async (request, reply) => {
      const { database } = request.server;
      const { id: eventId, rid } = request.params;

      await requireEventCapability(request, eventId, "rider.submit");
      const participant = await resolveCallerParticipant(request, eventId);

      const [rider] = await database
        .select()
        .from(schema.riders)
        .where(and(eq(schema.riders.id, rid), eq(schema.riders.eventId, eventId)));
      if (!rider) throw notFound("Rider not found");
      if (rider.ownerParticipantId !== participant.id) {
        throw forbidden("You may only remove your own rider");
      }

      await database.transaction(async (tx) => {
        await tx.delete(schema.riders).where(eq(schema.riders.id, rid));
        await writeAudit(tx, request, {
          capability: "rider.submit",
          action: "rider.remove",
          targetKind: "rider",
          targetId: rid,
          eventId,
          before: rider,
        });
      });

      return reply.status(204).send();
    },
  );
}
