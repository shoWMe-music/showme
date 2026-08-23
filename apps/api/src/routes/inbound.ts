import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { currencyForCountry } from "@showme/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import { canUseFeature } from "../lib/entitlements";
import { notifyProfileMembers } from "../lib/notify";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { isRepresentationActiveAt } from "../lib/representation-rules";

const IdParams = z.object({ id: z.string().uuid() });

/** Money on the wire is a decimal STRING of minor units (money.md); parse to bigint. */
const MinorUnits = z.string().regex(/^\d+$/, 'amount must be minor units, e.g. "50000"');

// Free text from a sender lands in someone else's inbox, so it is sanitized before
// the length checks run — the same treatment the public lead form gives its input
// (see `routes/public.ts`). All C0 control characters + DEL on single-line fields;
// tab and newline survive in the multi-line ones.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARACTERS_KEEPING_LINE_BREAKS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const cleanSingleLine = (value: string) =>
  value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();

const cleanMultipleLines = (value: string) =>
  value.replace(CONTROL_CHARACTERS_KEEPING_LINE_BREAKS, "").replace(/\r\n/g, "\n").trim();

/** A bounded, sanitized one-line field (a name, a label). */
const singleLineText = (maximumLength: number) =>
  z.string().transform(cleanSingleLine).pipe(z.string().min(1).max(maximumLength));

/** A bounded, sanitized multi-line field (a pitch, a note). */
const multipleLineText = (maximumLength: number) =>
  z.string().transform(cleanMultipleLines).pipe(z.string().min(1).max(maximumLength));

/** A bounded, sanitized, lower-cased email address. */
const emailAddress = z
  .string()
  .transform((value) => value.replace(CONTROL_CHARACTERS, "").trim().toLowerCase())
  .pipe(z.string().email().max(254));

/** A bounded, sanitized link (music / video). */
const linkUrl = z.string().transform(cleanSingleLine).pipe(z.string().url().max(500));

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
  // "incoming" (default) = requests targeting a profile I am a member of.
  // "outgoing" = offers/requests I have SENT from one of my profiles (fix-list #6).
  direction: z.enum(["incoming", "outgoing"]).optional().default("incoming"),
});

const UpdateStatusBody = z.object({ status: bookingRequestStatus });

/**
 * An outgoing offer. The date and the fee range are the ASK; everything below the
 * fold is WHO is asking and WHY — an offer that reaches a venue's inbox nameless
 * and pitchless is not an offer, it is noise (audit A-24, decisions.md #18/#6).
 * The identity fields are optional on the wire but never optional in the row: when
 * the caller omits them they are derived from the sending user and profile.
 */
const CreateOfferBody = z.object({
  targetProfileId: z.string().uuid(),
  wantedDate: z.string(),
  offerFeeMin: MinorUnits.optional(),
  offerFeeMax: MinorUnits.optional(),
  // Who is offering. Defaulted from the sender when omitted — never left blank.
  contactName: singleLineText(200).optional(),
  email: emailAddress.optional(),
  artistName: singleLineText(200).optional(),
  // Why. Free text, sanitized and length-bounded like any other inbox-bound input.
  pitch: multipleLineText(5000).optional(),
  note: multipleLineText(2000).optional(),
  musicUrl: linkUrl.optional(),
  videoUrl: linkUrl.optional(),
  // AGENT ONLY: the performer this offer is FOR (decisions.md #14). Accepted only
  // from an `agent`-kind profile with an ACTIVE representation of that performer;
  // anything else is a 400, never a silent drop.
  onBehalfOfProfileId: z.string().uuid().optional(),
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
  // WHO sent it. `senderProfileId` is null for a public-form request (no account).
  // `contactName` / `email` are the sender's business contact — the whole point of
  // a booking request is that the recipient can answer it, and this payload only
  // ever reaches members of the request's TARGET profile (incoming) or of its
  // SENDER profile (outgoing), never a third party. No separate field-level rule
  // applies: there is no capability under which a party may read the row but not
  // the contact on it.
  senderProfileId: z.string().nullable(),
  senderType: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  artistName: z.string().nullable(),
  // Set when an AGENT offers on behalf of a performer it represents: the venue's
  // inbox names the ACT (`artistName`) and can still see the agency behind it
  // (`contactName`). `onBehalfOfName` is the performer profile's own display name.
  onBehalfOfProfileId: z.string().nullable(),
  onBehalfOfName: z.string().nullable(),
  wantedDate: z.string().nullable(),
  pitch: z.string().nullable(),
  note: z.string().nullable(),
  musicUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  // `artistFee` is what a public-form sender asks for; `offerFeeMin/Max` is the
  // range a performer/agent offers. A row carries one shape or the other, so a
  // client that reads only the offer range shows nothing for public-form requests.
  artistFee: z.string().nullable(),
  offerFeeMin: z.string().nullable(),
  offerFeeMax: z.string().nullable(),
  // Denomination of the three amounts above; null when the venue's country is
  // unknown, and then the amount must be rendered without a currency symbol.
  currency: z.string().nullable(),
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

/**
 * Shape a booking-request row for the wire — bigint money → string, dates → ISO.
 * `onBehalfOfName` is the represented performer's display name, resolved by the
 * caller (a join on the list path, a single lookup elsewhere) rather than here, so
 * the serializer stays synchronous and free of I/O.
 */
function serializeBookingRequest(
  row: BookingRequestRow,
  onBehalfOfName: string | null = null,
): z.infer<typeof BookingRequestResponse> {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    targetProfileId: row.targetProfileId,
    senderProfileId: row.senderProfileId,
    senderType: row.senderType,
    contactName: row.contactName,
    email: row.email,
    artistName: row.artistName,
    onBehalfOfProfileId: row.onBehalfOfProfileId,
    onBehalfOfName,
    wantedDate: row.wantedDate,
    pitch: row.pitch,
    note: row.note,
    musicUrl: row.musicUrl,
    videoUrl: row.videoUrl,
    artistFee: row.artistFee?.toString() ?? null,
    offerFeeMin: row.offerFeeMin?.toString() ?? null,
    offerFeeMax: row.offerFeeMax?.toString() ?? null,
    currency: row.currency,
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

/**
 * The currency a request's fees are denominated in: the target VENUE's currency,
 * derived from its primary location's country (currency is a per-country fact —
 * decisions.md #17). Stamped once at creation so a later correction to the venue's
 * country cannot silently reprice requests already sent. Returns null when the
 * venue has no primary-location country, and the amount then renders bare.
 */
async function venueCurrency(
  database: FastifyInstance["database"],
  targetProfileId: string,
): Promise<string | null> {
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(
      and(
        eq(schema.profileLocations.profileId, targetProfileId),
        eq(schema.profileLocations.isPrimary, true),
      ),
    )
    .limit(1);
  return currencyForCountry(location?.country);
}

/**
 * The live representation linking an agent to a performer, or null. Every row for
 * the pair is read and the "is it live?" question answered by the shared
 * `isRepresentationActiveAt` — which is NOT `status = 'active'`, because a
 * termination effective-dated into the future leaves the agreement running until
 * that moment (decisions.md #14). Filtering in SQL would fork that definition, so
 * the rows come back whole and the one rule decides.
 */
async function findActiveRepresentation(
  database: FastifyInstance["database"],
  agentProfileId: string,
  performerProfileId: string,
): Promise<typeof schema.representations.$inferSelect | null> {
  const rows = await database
    .select()
    .from(schema.representations)
    .where(
      and(
        eq(schema.representations.agentProfileId, agentProfileId),
        eq(schema.representations.performerProfileId, performerProfileId),
      ),
    );
  const now = new Date();
  return rows.find((row) => isRepresentationActiveAt(row, now)) ?? null;
}

/** A profile's display name, or null when the id is null / the profile is gone. */
async function profileDisplayName(
  database: FastifyInstance["database"],
  profileId: string | null,
): Promise<string | null> {
  if (!profileId) return null;
  const [profile] = await database
    .select({ name: schema.profiles.name })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);
  return profile?.name ?? null;
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
          currency: await venueCurrency(database, body.targetProfileId),
        })
        .returning();
      if (!created) throw new Error("booking request create failed");

      // Realtime + feed: a request from the open web needs to reach the venue's
      // inbox. Best-effort — the request is already persisted and triageable, so a
      // delivery failure must never turn into a 500 for an anonymous sender.
      try {
        await notifyProfileMembers(database, created.targetProfileId, null, {
          type: "booking_request.received",
          title: `Booking request from ${created.artistName ?? created.contactName ?? "an artist"}`,
          body: created.wantedDate
            ? `They asked about ${created.wantedDate}.`
            : "A new request is waiting in your inbox.",
          link: "/requests",
          metadata: { bookingRequestId: created.id, source: created.source },
        });
      } catch (error) {
        request.log.error(
          { error, bookingRequestId: created.id },
          "booking-request notification failed",
        );
      }

      return reply.status(201).send({ id: created.id });
    },
  );

  // List the caller's booking requests. "incoming" (default) = requests targeting
  // any profile they are a member of; "outgoing" = requests/offers they have sent
  // from one of those profiles (fix-list #6). The membership set IS the
  // authorization either way; keyset paginated by `(created_at, id)`, optionally
  // filtered by status.
  app.get(
    "/booking-requests",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { cursor, limit, status, direction } = request.query;

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) {
        return { items: [], nextCursor: null };
      }

      // Incoming scopes on the target; outgoing scopes on the sender profile.
      const scope =
        direction === "outgoing"
          ? inArray(schema.bookingRequests.senderProfileId, profileIds)
          : inArray(schema.bookingRequests.targetProfileId, profileIds);

      // Truncate to milliseconds so the JS-Date-round-tripped cursor stays exact
      // (same approach as events-list) and never re-emits the boundary row.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.bookingRequests.createdAt})`;
      const decoded = cursor ? decodeCursor<BookingRequestCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.bookingRequests.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      // The represented performer's name comes along in the same query — the inbox
      // has to name the ACT, and a second round trip per row would be absurd.
      const rows = await database
        .select({ request: schema.bookingRequests, onBehalfOfName: schema.profiles.name })
        .from(schema.bookingRequests)
        .leftJoin(
          schema.profiles,
          eq(schema.profiles.id, schema.bookingRequests.onBehalfOfProfileId),
        )
        .where(
          and(scope, status ? eq(schema.bookingRequests.status, status) : undefined, afterCursor),
        )
        .orderBy(asc(createdAtMillis), asc(schema.bookingRequests.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        createdAt: row.request.createdAt,
        id: row.request.id,
      }));

      return {
        items: items.map((row) => serializeBookingRequest(row.request, row.onBehalfOfName)),
        nextCursor,
      };
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

      // Realtime + feed: the sender is waiting on this answer. Only on-platform
      // senders have a profile to notify; a public-form request has none, and the
      // operator replies to them by email instead.
      if (updated.senderProfileId) {
        try {
          await notifyProfileMembers(
            database,
            updated.senderProfileId,
            request.principal?.userId ?? null,
            {
              type: "booking_request.status_changed",
              title: `Your request was ${updated.status}`,
              body: updated.wantedDate ? `For ${updated.wantedDate}.` : undefined,
              link: "/requests",
              metadata: { bookingRequestId: updated.id, status: updated.status },
            },
          );
        } catch (error) {
          request.log.error({ error, bookingRequestId: updated.id }, "triage notification failed");
        }
      }

      return serializeBookingRequest(
        updated,
        await profileDisplayName(database, updated.onBehalfOfProfileId),
      );
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
      const senderMembership = principal.memberships.find(
        (membership) => membership.profileId === senderProfileId,
      );
      if (!senderMembership) throw badRequest("Select a profile to send the offer from");

      // Entitlement gate (decisions #4/§C): the free artist plan meters offers per
      // month. Composed AFTER authorization, always a fresh read — never conflated.
      const gate = await canUseFeature(database, senderProfileId, "send_offer");
      if (!gate.allowed) {
        throw forbidden(gate.reason ?? "Monthly offer limit reached — upgrade to send more");
      }

      // Who the offer is FROM: the sending profile plus the person behind it. The
      // row must never be anonymous, so these are the fallbacks for the identity
      // fields the caller may omit.
      const [sender] = await database
        .select({
          profileName: schema.profiles.name,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.profiles)
        .innerJoin(schema.users, eq(schema.users.id, principal.userId))
        .where(eq(schema.profiles.id, senderProfileId))
        .limit(1);
      if (!sender) throw badRequest("Select a profile to send the offer from");

      // An AGENT offers on behalf of an act it represents (decisions.md #14). Both
      // edges are required — the sending profile is an `agent`, AND a live
      // representation links it to that performer — and a failure is an explicit
      // 400: dropping the field silently would send the offer under the agency's
      // own name, which is exactly the anonymity this fixes.
      let onBehalfOfName: string | null = null;
      if (body.onBehalfOfProfileId) {
        if (senderMembership.kind !== "agent") {
          throw badRequest("Only an agent profile can offer on behalf of a performer");
        }
        const representation = await findActiveRepresentation(
          database,
          senderProfileId,
          body.onBehalfOfProfileId,
        );
        if (!representation) {
          throw badRequest("You have no active representation for that performer");
        }
        onBehalfOfName = await profileDisplayName(database, body.onBehalfOfProfileId);
        if (!onBehalfOfName) throw badRequest("That performer profile no longer exists");
      }

      // Defaults, not busywork: an omitted field is derived, never left null.
      // `artistName` is the ACT — the represented performer when an agent sends,
      // otherwise the sending profile itself.
      const contactName = body.contactName ?? sender.userName ?? sender.profileName;
      const email = body.email ?? sender.userEmail;
      const artistName = body.artistName ?? onBehalfOfName ?? sender.profileName;
      const senderType = senderMembership.kind === "agent" ? "agency" : "performer";

      let created: BookingRequestRow;
      // Resolved before the transaction: it is a read of the target venue, not part
      // of the write, and the offer's currency must be settled before the insert.
      const currency = await venueCurrency(database, body.targetProfileId);
      try {
        created = await database.transaction(async (tx) => {
          const [offer] = await tx
            .insert(schema.bookingRequests)
            .values({
              source: "performer_offer",
              status: "pending",
              targetProfileId: body.targetProfileId,
              senderUserId: principal.userId,
              senderProfileId,
              senderType,
              contactName,
              email,
              artistName,
              onBehalfOfProfileId: body.onBehalfOfProfileId,
              pitch: body.pitch,
              note: body.note,
              musicUrl: body.musicUrl,
              videoUrl: body.videoUrl,
              wantedDate: body.wantedDate,
              offerFeeMin: body.offerFeeMin != null ? BigInt(body.offerFeeMin) : undefined,
              offerFeeMax: body.offerFeeMax != null ? BigInt(body.offerFeeMax) : undefined,
              currency,
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

      // Realtime + feed: an offer is a request with a known sender, so name them.
      try {
        await notifyProfileMembers(database, created.targetProfileId, principal.userId, {
          type: "offer.received",
          title: `Offer from ${artistName}`,
          body: onBehalfOfName
            ? `${contactName} is offering ${onBehalfOfName} for ${created.wantedDate}.`
            : `Offered to play on ${created.wantedDate}.`,
          link: "/requests",
          metadata: { bookingRequestId: created.id },
        });
      } catch (error) {
        request.log.error({ error, offerId: created.id }, "offer notification failed");
      }

      return reply.status(201).send(serializeBookingRequest(created, onBehalfOfName));
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
