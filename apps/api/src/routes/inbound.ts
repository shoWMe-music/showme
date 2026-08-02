import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import { canUseFeature } from "../lib/entitlements";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";

const IdParams = z.object({ id: z.string().uuid() });

/** Money on the wire is a decimal STRING of minor units (money.md); parse to bigint. */
const MinorUnits = z.string().regex(/^\d+$/, 'amount must be minor units, e.g. "50000"');

const bookingRequestStatus = z.enum(["accepted", "declined", "archived", "flagged"]);

const CreatePublicRequestBody = z.object({
  source: z.literal("public_form"),
  targetProfileId: z.string().uuid(),
  contactName: z.string().min(1),
  email: z.string().email(),
  artistName: z.string().min(1).optional(),
  wantedDate: z.string().optional(),
  pitch: z.string().optional(),
  offerFeeMin: MinorUnits.optional(),
  offerFeeMax: MinorUnits.optional(),
});

const ListQuery = PaginationQuery.extend({
  status: z.enum(["pending", "accepted", "declined", "flagged", "archived", "expired"]).optional(),
});

const UpdateStatusBody = z.object({ status: bookingRequestStatus });

const CreateOfferBody = z.object({
  targetProfileId: z.string().uuid(),
  wantedDate: z.string(),
  offerFeeMin: MinorUnits.optional(),
  offerFeeMax: MinorUnits.optional(),
});

const FlagSpamBody = z.object({ kind: z.string().min(1) });

const HandoffBody = z
  .object({ name: z.string().min(1).optional(), recipientEmail: z.string().email().optional() })
  .nullish();

const BookingRequestResponse = z.object({
  id: z.string(),
  source: z.string(),
  status: z.string(),
  targetProfileId: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  artistName: z.string().nullable(),
  wantedDate: z.string().nullable(),
  pitch: z.string().nullable(),
  offerFeeMin: z.string().nullable(),
  offerFeeMax: z.string().nullable(),
  createdAt: z.string(),
});

const ListResponse = z.object({
  items: z.array(BookingRequestResponse),
  nextCursor: z.string().nullable(),
});

const CreatedIdResponse = z.object({ id: z.string() });
const FlagResponse = z.object({ id: z.string(), flagged: z.literal(true) });
const HandoffResponse = z.object({ profileId: z.string(), invitationId: z.string() });

type BookingRequestRow = typeof schema.bookingRequests.$inferSelect;

/** Keyset cursor over `(created_at, id)` — opaque to the client. */
interface BookingRequestCursor {
  createdAt: string;
  id: string;
}

/** Shape a booking-request row for the wire — bigint money → string, dates → ISO. */
function serializeBookingRequest(row: BookingRequestRow): z.infer<typeof BookingRequestResponse> {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    targetProfileId: row.targetProfileId,
    contactName: row.contactName,
    email: row.email,
    artistName: row.artistName,
    wantedDate: row.wantedDate,
    pitch: row.pitch,
    offerFeeMin: row.offerFeeMin?.toString() ?? null,
    offerFeeMax: row.offerFeeMax?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Postgres unique-violation — the partial pending-dedup / spam-flag constraint tripped. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/** An opaque link token for the handoff invitation — never guessable, never typed. */
function generateToken(): string {
  return randomBytes(24).toString("hex");
}

export async function inboundRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Create from the PUBLIC booking form — no auth, no principal. Anyone on the open
  // web can pitch a target profile; we only ever hand back the new id (never any
  // other request), so the endpoint can't be used to enumerate a profile's inbox.
  app.post(
    "/booking-requests",
    {
      config: { public: true },
      schema: { body: CreatePublicRequestBody, response: { 201: CreatedIdResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;

      const [created] = await database
        .insert(schema.bookingRequests)
        .values({
          source: "public_form",
          status: "pending",
          targetProfileId: body.targetProfileId,
          contactName: body.contactName,
          email: body.email,
          artistName: body.artistName,
          wantedDate: body.wantedDate,
          pitch: body.pitch,
          offerFeeMin: body.offerFeeMin != null ? BigInt(body.offerFeeMin) : undefined,
          offerFeeMax: body.offerFeeMax != null ? BigInt(body.offerFeeMax) : undefined,
        })
        .returning();
      if (!created) throw new Error("booking request create failed");

      return reply.status(201).send({ id: created.id });
    },
  );

  // List the caller's incoming requests — those targeting any profile they are a
  // member of. The membership set IS the authorization; keyset paginated by
  // `(created_at, id)`, optionally filtered by status.
  app.get(
    "/booking-requests",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { cursor, limit, status } = request.query;

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) {
        return { items: [], nextCursor: null };
      }

      // Truncate to milliseconds so the JS-Date-round-tripped cursor stays exact
      // (same approach as events-list) and never re-emits the boundary row.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.bookingRequests.createdAt})`;
      const decoded = cursor ? decodeCursor<BookingRequestCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.bookingRequests.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      const rows = await database
        .select()
        .from(schema.bookingRequests)
        .where(
          and(
            inArray(schema.bookingRequests.targetProfileId, profileIds),
            status ? eq(schema.bookingRequests.status, status) : undefined,
            afterCursor,
          ),
        )
        .orderBy(asc(createdAtMillis), asc(schema.bookingRequests.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        createdAt: row.createdAt,
        id: row.id,
      }));

      return { items: items.map(serializeBookingRequest), nextCursor };
    },
  );

  // Triage a request — accept / decline / archive / flag. Authority is the caller's
  // role on the request's TARGET profile (owner/admin); a non-member gets a 404.
  app.patch(
    "/booking-requests/:id",
    {
      schema: {
        params: IdParams,
        body: UpdateStatusBody,
        response: { 200: BookingRequestResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const [before] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!before) throw notFound("Booking request not found");

      requireProfileRole(request, before.targetProfileId, ["owner", "admin"]);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.bookingRequests)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(eq(schema.bookingRequests.id, id))
          .returning();
        if (!after) throw notFound("Booking request not found");
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "booking_request.update",
          targetKind: "booking_request",
          targetId: id,
          before,
          after,
        });
        return after;
      });

      return serializeBookingRequest(updated);
    },
  );

  // A performer's outbound offer — a booking request the OTHER way. The partial
  // unique index on `(sender_user_id, target_profile_id, wanted_date) WHERE
  // status='pending'` makes a duplicate live offer a 23505 → 409.
  app.post(
    "/offers",
    { schema: { body: CreateOfferBody, response: { 201: BookingRequestResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // An offer is sent AS a profile — needed to resolve the plan tier.
      const senderProfileId = principal.actingProfileId;
      if (!senderProfileId) throw badRequest("Select a profile to send the offer from");

      // Entitlement gate (decisions #4/§C): the free artist plan meters offers per
      // month. Composed AFTER authorization, always a fresh read — never conflated.
      const gate = await canUseFeature(database, senderProfileId, "send_offer");
      if (!gate.allowed) {
        throw forbidden(gate.reason ?? "Monthly offer limit reached — upgrade to send more");
      }

      let created: BookingRequestRow;
      try {
        created = await database.transaction(async (tx) => {
          const [offer] = await tx
            .insert(schema.bookingRequests)
            .values({
              source: "performer_offer",
              status: "pending",
              targetProfileId: body.targetProfileId,
              senderUserId: principal.userId,
              senderProfileId: principal.actingProfileId,
              wantedDate: body.wantedDate,
              offerFeeMin: body.offerFeeMin != null ? BigInt(body.offerFeeMin) : undefined,
              offerFeeMax: body.offerFeeMax != null ? BigInt(body.offerFeeMax) : undefined,
            })
            .returning();
          if (!offer) throw new Error("offer create failed");
          await writeAudit(tx, request, {
            capability: "event.view",
            action: "offer.create",
            targetKind: "booking_request",
            targetId: offer.id,
            after: offer,
          });
          return offer;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("You already have a pending offer for this target and date");
        }
        throw error;
      }

      return reply.status(201).send(serializeBookingRequest(created));
    },
  );

  // Report a request as spam — one flag per (target, reporter, kind); the second
  // trips the unique constraint → 409. Suspension is COMPUTED elsewhere from the
  // distinct-reporter count, never stored here.
  app.post(
    "/booking-requests/:id/flag-spam",
    {
      schema: { params: IdParams, body: FlagSpamBody, response: { 201: FlagResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      if (!principal.actingProfileId) {
        throw badRequest("Select a profile (X-Profile-Id) to report as");
      }
      const reporterProfileId = principal.actingProfileId;

      const [target] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!target) throw notFound("Booking request not found");

      try {
        await database.transaction(async (tx) => {
          const [flag] = await tx
            .insert(schema.spamFlags)
            .values({
              targetProfileId: target.targetProfileId,
              reporterProfileId,
              reporterUserId: principal.userId,
              kind: request.body.kind,
              contextKind: "booking_request",
              contextId: id,
            })
            .returning();
          if (!flag) throw new Error("spam flag create failed");
          await writeAudit(tx, request, {
            capability: "event.view",
            action: "spam.flag",
            targetKind: "booking_request",
            targetId: id,
            after: flag,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("You have already flagged this");
        }
        throw error;
      }

      return reply.status(201).send({ id, flagged: true as const });
    },
  );

  // Hand an event off to a venue not yet on the platform: mint an UNCLAIMED stub
  // profile (claimed_at NULL) plus a `venue_handoff` invitation linking it to the
  // event. The claim flow (taking ownership of the stub) lives in the invitations
  // module. Authority is `event.edit` on the event being handed off.
  app.post(
    "/events/:id/handoff",
    { schema: { params: IdParams, body: HandoffBody, response: { 201: HandoffResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body ?? {};
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, id, "event.edit");

      const created = await database.transaction(async (tx) => {
        const suffix = randomBytes(6).toString("hex");
        // A stub profile: owned by the current caller as a placeholder, but
        // claimed_at NULL marks it unclaimed — the recipient claims it later.
        const [stub] = await tx
          .insert(schema.profiles)
          .values({
            kind: "operator",
            ownerUserId: principal.userId,
            name: body.name ?? "Unclaimed venue",
            slug: `handoff-${suffix}`,
            claimedAt: null,
            createdBy: principal.userId,
          })
          .returning();
        if (!stub) throw new Error("handoff stub create failed");

        const [invitation] = await tx
          .insert(schema.invitations)
          .values({
            type: "event_participant",
            source: "venue_handoff",
            status: "pending",
            token: generateToken(),
            recipientEmail: body.recipientEmail,
            targetEventId: id,
            targetProfileId: stub.id,
            role: "co_host",
            createdByUser: principal.userId,
            createdByProfile: principal.actingProfileId,
          })
          .returning();
        if (!invitation) throw new Error("handoff invitation create failed");

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "event.handoff",
          targetKind: "event",
          targetId: id,
          eventId: id,
          after: { profileId: stub.id, invitationId: invitation.id },
        });

        return { profileId: stub.id, invitationId: invitation.id };
      });

      return reply.status(201).send(created);
    },
  );
}
