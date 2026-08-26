import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { currencyForCountry } from "@showme/shared";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { canUseFeature } from "../lib/entitlements";
import { resolveEventTimezone } from "../lib/event-timezone";
import { serializeCalendarItem } from "../serialize/calendar";

const CalendarParams = z.object({ id: z.string().uuid() });

/**
 * The kinds a person may WRITE. `external` is absent on purpose: an external
 * event is not authored here, it arrives from somebody else's calendar through
 * `lib/external-calendar.ts`, which stamps its provenance at the same time. This
 * omission is what keeps `type = 'external'` and `external_source IS NOT NULL`
 * from ever disagreeing — see the enum's note in `schema/enums.ts`.
 */
const authoredCalendarItemType = z.enum(["task", "appointment", "note"]);

const CreateCalendarBody = z.object({
  type: authoredCalendarItemType,
  title: z.string().min(1),
  date: z.string().min(1),
  endDate: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  ownerProfileId: z.string().uuid().optional(),
  ownerUserId: z.string().optional(),
  entity: z.string().optional(),
  assigneeUserId: z.string().optional(),
  assigneeName: z.string().optional(),
});

const UpdateCalendarBody = z.object({
  type: authoredCalendarItemType.optional(),
  title: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  endDate: z.string().min(1).nullable().optional(),
  startTime: z.string().min(1).nullable().optional(),
  endTime: z.string().min(1).nullable().optional(),
  entity: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
});

/** "Available anyway" — the user's override on an imported entry. */
const BlocksAvailabilityBody = z.object({ blocksAvailability: z.boolean() });

/**
 * Turn an imported entry into a real show. Everything is optional and derived
 * from the entry, exactly as `POST /booking-requests/:id/draft-event` derives
 * from the request — the body exists only so the user can correct it first.
 */
const PromoteEventBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** ISO 4217, upper-cased. Derived from the profile's country when omitted. */
    baseCurrency: z
      .string()
      .transform((value) => value.trim().toUpperCase())
      .pipe(z.string().length(3))
      .optional(),
  })
  .nullish();

const ListQuery = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

const CalendarResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  type: z.string(),
  /** "Busy" for an imported entry belonging to somebody else — see the serializer. */
  title: z.string(),
  titleWithheld: z.boolean(),
  date: z.string(),
  endDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  entity: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalId: z.string().nullable(),
  blocksAvailability: z.boolean(),
  promotedEventId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What promoting produces, with the plan consequence said out loud — the same
 * contract `DraftEventResponse` states, for the same reason. A promoted entry
 * lands as a DRAFT, and a draft costs nothing: the free-tier cap counts events in
 * `confirmed`/`concluded` (`assertEventCapAllows`), so it bites when the show is
 * confirmed. Returning the live counter lets the screen say that instead of
 * either hiding the cost or inventing one.
 */
const PromoteEventResponse = z.object({
  calendarItemId: z.string(),
  eventId: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  baseCurrency: z.string(),
  status: z.string(),
  eventCap: z.object({
    allowed: z.boolean(),
    used: z.number().nullable(),
    limit: z.number().nullable(),
    /** Always true: the cap bites when the event is confirmed, not now. */
    chargedAtConfirm: z.literal(true),
  }),
});

const DeleteResponse = z.object({ id: z.string(), deleted: z.boolean() });

type CalendarRow = typeof schema.calendarItems.$inferSelect;

/** Serialize for THIS reader — the title of an import is owner-only. */
function forViewer(item: CalendarRow, request: FastifyRequest) {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  return serializeCalendarItem(item, principal.userId);
}

/**
 * Owner-scoped access: a calendar item is reachable iff the caller owns it
 * directly or through a profile they belong to. Non-reachable is a 404.
 */
async function loadAccessibleItem(request: FastifyRequest, id: string): Promise<CalendarRow> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const [item] = await database
    .select()
    .from(schema.calendarItems)
    .where(eq(schema.calendarItems.id, id));
  if (!item) throw notFound("Calendar item not found");

  if (item.ownerUserId && item.ownerUserId === principal.userId) return item;
  if (
    item.ownerProfileId &&
    principal.memberships.some((m) => m.profileId === item.ownerProfileId)
  ) {
    return item;
  }
  throw notFound("Calendar item not found");
}

/** Validate the caller may create in the requested scope; throws 403 otherwise. */
function assertMayWriteScope(
  request: FastifyRequest,
  scope: { ownerUserId: string | null; ownerProfileId?: string },
): void {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  if (scope.ownerUserId && scope.ownerUserId !== principal.userId) {
    throw forbidden("Cannot create an item owned by another user");
  }
  if (
    scope.ownerProfileId &&
    !principal.memberships.some((m) => m.profileId === scope.ownerProfileId)
  ) {
    throw forbidden("You are not a member of that profile");
  }
}

/**
 * The currency to denominate a promoted event in, from the owning profile's
 * primary location. Mirrors what `routes/inbound.ts` does for a draft event —
 * an event's `base_currency` is what its whole budget and settlement are
 * denominated in, so a guess is worse than a refusal.
 */
async function profileCurrency(
  database: FastifyInstance["database"],
  profileId: string,
): Promise<string | null> {
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(
      and(
        eq(schema.profileLocations.profileId, profileId),
        eq(schema.profileLocations.isPrimary, true),
      ),
    )
    .limit(1);
  return currencyForCountry(location?.country);
}

export async function calendarRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own + their profiles' items, optionally within a date range.
  app.get(
    "/calendar",
    { schema: { querystring: ListQuery, response: { 200: z.array(CalendarResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { from, to } = request.query;

      const profileIds = principal.memberships.map((m) => m.profileId);
      const ownerConditions = [eq(schema.calendarItems.ownerUserId, principal.userId)];
      if (profileIds.length > 0) {
        ownerConditions.push(inArray(schema.calendarItems.ownerProfileId, profileIds));
      }
      const ownerFilter = or(...ownerConditions);

      const rows = await database
        .select()
        .from(schema.calendarItems)
        .where(
          and(
            ownerFilter,
            from ? gte(schema.calendarItems.date, from) : undefined,
            to ? lte(schema.calendarItems.date, to) : undefined,
          ),
        )
        .orderBy(asc(schema.calendarItems.date), asc(schema.calendarItems.id));

      return rows.map((row) => forViewer(row, request));
    },
  );

  // Create a personal / profile-scoped calendar item.
  app.post(
    "/calendar",
    { schema: { body: CreateCalendarBody, response: { 201: CalendarResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const body = request.body;

      const ownerUserId = body.ownerUserId ?? (body.ownerProfileId ? null : principal.userId);
      assertMayWriteScope(request, { ownerUserId, ownerProfileId: body.ownerProfileId });
      if (body.endDate && body.endDate < body.date) {
        throw badRequest("The end date is before the start date");
      }

      const created = await database.transaction(async (tx) => {
        const [item] = await tx
          .insert(schema.calendarItems)
          .values({
            ownerProfileId: body.ownerProfileId ?? null,
            ownerUserId,
            type: body.type,
            title: body.title,
            date: body.date,
            endDate: body.endDate ?? null,
            startTime: body.startTime ?? null,
            endTime: body.endTime ?? null,
            entity: body.entity ?? null,
            assigneeUserId: body.assigneeUserId ?? null,
            assigneeName: body.assigneeName ?? null,
          })
          .returning();
        if (!item) throw new Error("calendar item create failed");
        const serialized = forViewer(item, request);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.create",
          targetKind: "calendar_item",
          targetId: item.id,
          after: serialized,
        });
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Update an item within the caller's scope.
  app.patch(
    "/calendar/:id",
    {
      schema: {
        params: CalendarParams,
        body: UpdateCalendarBody,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);
      const body = request.body;

      // An imported entry is a cached copy of somebody else's row: editing it here
      // would be overwritten by the very next sync, which is a worse experience
      // than being told no. "Available anyway" is the one thing that IS ours to
      // change, and it has its own route below.
      if (before.type === "external") {
        throw conflict(
          "This entry comes from a connected calendar — edit it there, or use 'available anyway'",
        );
      }

      const nextDate = body.date ?? before.date;
      const nextEndDate = body.endDate === undefined ? before.endDate : body.endDate;
      if (nextEndDate && nextEndDate < nextDate) {
        throw badRequest("The end date is before the start date");
      }

      const fields: Partial<typeof schema.calendarItems.$inferInsert> = { updatedAt: new Date() };
      if (body.type !== undefined) fields.type = body.type;
      if (body.title !== undefined) fields.title = body.title;
      if (body.date !== undefined) fields.date = body.date;
      if (body.endDate !== undefined) fields.endDate = body.endDate;
      if (body.startTime !== undefined) fields.startTime = body.startTime;
      if (body.endTime !== undefined) fields.endTime = body.endTime;
      if (body.entity !== undefined) fields.entity = body.entity;
      if (body.assigneeUserId !== undefined) fields.assigneeUserId = body.assigneeUserId;
      if (body.assigneeName !== undefined) fields.assigneeName = body.assigneeName;

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.calendarItems)
          .set(fields)
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!after) throw notFound("Calendar item not found");
        const serialized = forViewer(after, request);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.update",
          targetKind: "calendar_item",
          targetId: id,
          before: forViewer(before, request),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  /**
   * "Available anyway" — the user's override on an imported entry.
   *
   * Its own route rather than a field on the PATCH above for two reasons that both
   * matter: the PATCH refuses imported entries outright (their content belongs to
   * the far side), and this is the one decision about them that is genuinely ours.
   * A dedicated action also gives the audit trail a legible verb — a reader of the
   * log sees "this user re-opened that night", not "a boolean moved".
   *
   * It changes availability the moment it is written: `lib/availability.ts` reads
   * the flag, so the public page and the share window both follow on the next read.
   */
  app.patch(
    "/calendar/:id/availability",
    {
      schema: {
        params: CalendarParams,
        body: BlocksAvailabilityBody,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);

      if (before.type !== "external") {
        throw badRequest("Only an imported calendar entry blocks availability");
      }

      return database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.calendarItems)
          .set({
            blocksAvailability: request.body.blocksAvailability,
            updatedAt: new Date(),
          })
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!after) throw notFound("Calendar item not found");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: request.body.blocksAvailability
            ? "calendar.blocks_availability"
            : "calendar.available_anyway",
          targetKind: "calendar_item",
          targetId: id,
          before: { blocksAvailability: before.blocksAvailability },
          after: { blocksAvailability: after.blocksAvailability },
        });
        return forViewer(after, request);
      });
    },
  );

  /**
   * "Turn it into a show" — promote an imported entry into a real shoWMe event.
   *
   * This is the SAME operation as `POST /booking-requests/:id/draft-event` and it
   * is built the same way deliberately: a non-event becomes a DRAFT event, the two
   * stay linked by a column on the non-event (`promoted_event_id` here,
   * `booking_requests.event_id` there), the mutation is audited and posted to the
   * activity feed, and the plan consequence is reported rather than hidden. Two
   * shapes for one operation would be two sets of bugs.
   *
   * WHAT IT COSTS: nothing today. The free-tier cap counts `confirmed`/`concluded`
   * events, and this lands on the `draft` column default by construction — the
   * response carries the live counter so the screen can say "confirming it later
   * is what spends a slot".
   *
   * WHAT IT DOES NOT DO: stop the entry blocking. The commitment is still on the
   * user's real calendar and still occupies that night — now as a show as well.
   * The two do not double-count, because availability is a union of windows, not a
   * sum.
   */
  app.post(
    "/calendar/:id/promote-event",
    {
      schema: {
        params: CalendarParams,
        body: PromoteEventBody,
        response: { 201: PromoteEventResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body ?? {};
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const item = await loadAccessibleItem(request, id);

      if (item.type !== "external") {
        throw badRequest("Only an imported calendar entry can become a show");
      }
      if (item.promotedEventId) {
        throw conflict("This entry is already a show");
      }
      // An event is hosted by a profile, and availability is a profile's. An entry
      // that occupies nobody's profile calendar has no host to give the show.
      if (!item.ownerProfileId) {
        throw badRequest("Import this calendar into a profile before turning entries into shows");
      }

      const membership = principal.memberships.find((m) => m.profileId === item.ownerProfileId);
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        throw forbidden("Only an owner or admin of this profile can create an event");
      }
      // The same rule `POST /events` and the draft-event route enforce — an event
      // is hosted by an operator (story.md: the operator runs the show and carries
      // the residual). A performer's imported gig is still a booking somebody else
      // hosts, not an event they create.
      if (membership.kind !== "operator") {
        throw forbidden("Only operator profiles can create events");
      }

      const baseCurrency =
        body.baseCurrency ?? (await profileCurrency(database, item.ownerProfileId));
      if (!baseCurrency) {
        throw badRequest(
          "Set a country on your profile's primary location, or pass a currency, before turning a calendar entry into a show",
        );
      }

      const ownerProfileId = item.ownerProfileId;
      const [ownerProfile] = await database
        .select({ name: schema.profiles.name, type: schema.profiles.type })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, ownerProfileId));

      const created = await database.transaction(async (tx) => {
        const [permissionSet] = await tx
          .insert(schema.permissionSets)
          .values({
            profileId: ownerProfileId,
            name: "operator_full",
            capabilities: [...PRESET_PERMISSION_SETS.operator_full],
          })
          .returning();
        if (!permissionSet) throw new Error("permission set create failed");

        // A venue hosting its own show is its own venue; a promoter is not, and
        // stamping it would put the wrong address (and timezone) on the event.
        const venueProfileId = ownerProfile?.type === "venue" ? ownerProfileId : undefined;
        const timezone = await resolveEventTimezone(tx, venueProfileId, undefined);

        const [event] = await tx
          .insert(schema.events)
          .values({
            hostProfileId: ownerProfileId,
            title: body.title ?? item.title,
            baseCurrency,
            eventDate: item.date,
            // The imported window becomes the stage window. Door time is left
            // unset: a calendar entry says when the commitment runs, never when
            // the room opens, and inventing one puts a false fact on the event.
            startTime: item.startTime ?? undefined,
            endTime: item.endTime ?? undefined,
            venueProfileId,
            venueName: venueProfileId ? (ownerProfile?.name ?? undefined) : undefined,
            notes: promotedEventNotes(item),
            timezone,
            createdBy: principal.userId,
          })
          .returning();
        if (!event) throw new Error("promoted event create failed");

        await tx.insert(schema.eventParticipants).values({
          eventId: event.id,
          profileId: ownerProfileId,
          role: "host",
          permissionSetId: permissionSet.id,
          status: "confirmed",
        });

        const [linked] = await tx
          .update(schema.calendarItems)
          .set({ promotedEventId: event.id, updatedAt: new Date() })
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!linked) throw notFound("Calendar item not found");

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "calendar.promote_event",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: forViewer(item, request),
          after: { event, calendarItemId: id },
        });
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "event.created",
          targetKind: "event",
          targetId: event.id,
          summary: { title: event.title, fromCalendarItemId: id },
        });

        return event;
      });

      // A FRESH read of the entitlement layer (decisions #4 — never conflated with
      // authorization, never cached): what the plan allows RIGHT NOW, so the screen
      // can name the consequence of confirming this draft later.
      const eventCap = await canUseFeature(database, ownerProfileId, "create_event");

      return reply.status(201).send({
        calendarItemId: id,
        eventId: created.id,
        title: created.title,
        eventDate: created.eventDate ?? null,
        baseCurrency: created.baseCurrency,
        status: created.status,
        eventCap: {
          allowed: eventCap.allowed,
          used: eventCap.used ?? null,
          limit: eventCap.limit ?? null,
          chargedAtConfirm: true as const,
        },
      });
    },
  );

  // Delete an item within the caller's scope.
  app.delete(
    "/calendar/:id",
    { schema: { params: CalendarParams, response: { 200: DeleteResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);

      await database.transaction(async (tx) => {
        await tx.delete(schema.calendarItems).where(eq(schema.calendarItems.id, id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.delete",
          targetKind: "calendar_item",
          targetId: id,
          before: forViewer(before, request),
        });
      });

      return { id, deleted: true };
    },
  );
}

/**
 * What the draft carries over from the entry it came from. The provenance goes in
 * the notes rather than into a field of its own, exactly as a draft event records
 * the booking request it came from: it is context for whoever picks the draft up,
 * not structured data anything queries.
 */
function promotedEventNotes(item: CalendarRow): string {
  const lines = [`Created from a ${item.externalSource ?? "calendar"} entry: ${item.title}`];
  if (item.endDate && item.endDate !== item.date) {
    lines.push(`Runs ${item.date} → ${item.endDate}.`);
  }
  if (item.entity) lines.push(`Location on the original entry: ${item.entity}.`);
  return lines.join("\n");
}
