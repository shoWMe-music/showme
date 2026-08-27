import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import {
  type Capability,
  type DealDraft,
  basisPointsToPercent,
  dealDraftProblems,
  minorToDecimalString,
} from "@showme/shared";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { changedFieldNames, writeActivity } from "../lib/activity";
import { autoAssignAgentOnPerformerJoin } from "../lib/agent-assignment";
import type { Transaction } from "../lib/audit";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { assertEventCapAllows } from "../lib/entitlements";
import { resolveEventTimezone } from "../lib/event-timezone";
import { notifyProfileMembers } from "../lib/notify";
import { assertProfileImageFiles, signProfileImageUrls } from "../lib/profile-media";
import { withIdempotency } from "../plugins/idempotency";
import { serializeDealUnredacted } from "../serialize/deal";
import { serializeEvent } from "../serialize/event";
import { type EventExtras, EventExtrasSchema } from "../serialize/event-extras";

const EventParams = z.object({ id: z.string().uuid() });

/** LOCAL wall-clock "HH:MM" or "HH:MM:SS" (offset-free; anchored by timezone). */
const LocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected HH:MM (24h) local time");

/**
 * A show's poster may only be a file the host profile uploaded into its own
 * storage folder.
 *
 * `assertProfileImageFiles` is the profile editor's check, unchanged — the
 * ownership question is identical ("is this file this profile's?") and the answer
 * must not be allowed to differ between a venue's avatar and its show's poster.
 * `undefined` means the caller said nothing about the picture; `null` means they
 * removed it. Neither names a file, so neither is checked.
 */
async function assertEventImageFile(
  database: Parameters<typeof assertProfileImageFiles>[0],
  hostProfileId: string,
  imageFileId: string | null | undefined,
): Promise<void> {
  if (!imageFileId) return;
  await assertProfileImageFiles(database, hostProfileId, [imageFileId]);
}

/**
 * The poster, in the two forms the schema keeps — an uploaded FILE or an external
 * ADDRESS (see migration 0026). Declared once and spread into both bodies,
 * because "how a show names its picture" must not be able to differ between
 * creating one and editing one.
 *
 * Setting one does not clear the other: the read side resolves the ladder (file
 * wins), so the editor sends `imageFileId` on upload and both as `null` to take
 * the poster off — exactly the contract the profile editor already follows.
 */
const httpImageUrl = z
  .string()
  .url()
  .max(2000)
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "An image address must be http(s).",
  );

const EventImageFields = {
  imageFileId: z.string().uuid().nullable().optional(),
  imageUrl: httpImageUrl.nullable().optional(),
};

// ── The bill, and the agreement, stated at create ────────────────────────────
//
// The create wizard's second step asks for the deal, and until now the answer
// went into `events.extras.dealDraft`, which NOTHING reads (ClickUp 86cbaxu52):
// the operator typed a guarantee and a split, the screen said the settlement was
// being set up, and `select count(*) from deals where event_id = …` answered 0.
//
// A deal cannot be stated without saying who it is WITH, and a `deal_parties`
// row keys to an `event_participants` row — which does not exist while the event
// is still being created. So the two arrive together: `participants` names the
// profiles joining the bill, `deal.parties` names them again by their ROLE in
// the agreement, and the resolver below turns both into rows inside the one
// transaction that creates the event.
//
// The parties are named by PROFILE, deliberately. A participant id is something
// only the server can know here, and inventing a client-side placeholder for one
// would be a second identity to keep straight. Every profile a deal names must
// be either the host or one of the participants this same request adds — a deal
// may not reach for a stranger.
//
// Two things this deliberately does NOT do:
//   - it does not accept `commission` as a party role. decisions #14 puts an
//     agent's commission in its own representation-scoped settlement, and the
//     one remaining reading (a disclosed, off-the-top commission) is not wired
//     into the engine — offering it would be offering a term nothing pays.
//   - it does not accept a `cost_split` in any form (decisions #16.3: a deal
//     starts with none and the operator opts in later).

const CreateEventDealParty = z.object({
  /**
   * A PROFILE, not an `event_participants` id: no participant exists until this
   * request creates them. The row created for this profile IS the deal party.
   */
  profileId: z.string().uuid(),
  /**
   * `commission` is absent on purpose — see the block above. `payer` funds the
   * agreement; `payee` / `split_member` are the lines the engine pays.
   */
  roleInDeal: z.enum(["payer", "payee", "split_member", "observer"]),
  /** Basis points of THIS deal's payout, read only when several lines share it. */
  share: z
    .object({ splitBasisPoints: z.number().int().min(0).max(10000) })
    .strict()
    .optional(),
});

const CreateEventDeal = z.object({
  type: z.enum(schema.dealType.enumValues),
  /**
   * Absent = a paper-only agreement (`deals.structure` NULL): recorded, signed,
   * never computed. The four named here are the whole of `dealEntitlement()`
   * (decisions #16.2) — a shape outside them is paper, not a fifth structure.
   */
  structure: z.enum(["guarantee", "door_split", "guarantee_vs_door", "rental"]).optional(),
  name: z.string().min(1),
  /** Minor units as a decimal string (money.md) — parsed to bigint server-side. */
  guaranteeAmount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  advanceAmount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  /** Basis points of the POOL (4000 = 40.00%), matching `deals.split_basis_points`. */
  splitBasisPoints: z.number().int().min(0).max(10000).optional(),
  paymentTiming: z.enum(["before_event", "at_settlement", "due_date"]).optional(),
  parties: z.array(CreateEventDealParty).min(1),
});

/**
 * A profile joining the bill as the event is created.
 *
 * `performer` and `support` only. `crew` carries a sponsor stamp (decisions #12)
 * and `agent` an auto-assignment rule (#14) that both belong to the routes that
 * own them; a co-host is a grant of authority that should be asked for out loud
 * rather than folded into a create.
 */
const CreateEventParticipant = z.object({
  profileId: z.string().uuid(),
  role: z.enum(["performer", "support"]).default("performer"),
  performerTag: z.enum(["headliner", "support", "dj", "opener"]).optional(),
});

type CreateEventDealBody = z.infer<typeof CreateEventDeal>;

/**
 * The stated deal, in the shape `dealDraftProblems()` already judges.
 *
 * That validator is the composer's, and it stays the only one: every rule it
 * states (an agreement needs a party, an entitled line, a fixed amount for a
 * fixed structure, shares that divide the payout exactly) is a rule this path
 * needs too, and a second copy would be a second answer. It reads MAJOR units
 * and percentages as typed, so the minor-unit wire values are converted back —
 * cheaper than teaching two modules two number formats.
 *
 * `participantId` carries a PROFILE id here. The rules it feeds are
 * identity-agnostic (is a line filled in, is it duplicated, do the shares add
 * up), and every one of these profiles becomes a participant a few lines later.
 */
function dealDraftFromBody(deal: CreateEventDealBody, currency: string): DealDraft {
  const major = (minor: string | undefined): string =>
    minor == null ? "" : minorToDecimalString({ amount: BigInt(minor), currency });
  return {
    name: deal.name,
    type: deal.type,
    structure: deal.structure ?? null,
    currency,
    guaranteeAmount: major(deal.guaranteeAmount),
    advanceAmount: major(deal.advanceAmount),
    splitPercent: deal.splitBasisPoints == null ? "" : basisPointsToPercent(deal.splitBasisPoints),
    paymentTiming: deal.paymentTiming ?? "at_settlement",
    parties: deal.parties.map((party, index) => ({
      key: `party-${index}`,
      participantId: party.profileId,
      roleInDeal: party.roleInDeal,
      sharePercent: party.share == null ? "" : basisPointsToPercent(party.share.splitBasisPoints),
    })),
  };
}

/**
 * Refuse a deal the settlement engine could not reconcile, before anything is
 * written — a 400 saying which rule broke, rather than a row that settles as
 * nothing.
 */
function assertDealIsSettleable(
  deal: CreateEventDealBody,
  currency: string,
  reachableProfileIds: ReadonlySet<string>,
): void {
  for (const party of deal.parties) {
    if (!reachableProfileIds.has(party.profileId)) {
      throw badRequest("Every deal party must be a participant on this event");
    }
  }
  const problems = dealDraftProblems(dealDraftFromBody(deal, currency));
  if (problems.length > 0) throw badRequest(problems.join(" "));
}

/**
 * Join the profiles named on the bill, and answer with participant id per
 * profile — the host's own row included, because the host is a party to its own
 * agreements and `deal_parties` needs the id either way.
 */
async function joinParticipants(
  tx: Transaction,
  request: FastifyRequest,
  input: {
    eventId: string;
    hostParticipantId: string;
    hostProfileId: string;
    participants: z.infer<typeof CreateEventParticipant>[];
  },
): Promise<Map<string, string>> {
  const participantIdByProfile = new Map<string, string>([
    [input.hostProfileId, input.hostParticipantId],
  ]);
  if (input.participants.length === 0) return participantIdByProfile;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  for (const joining of input.participants) {
    if (participantIdByProfile.has(joining.profileId)) continue;
    const [participant] = await tx
      .insert(schema.eventParticipants)
      .values({
        eventId: input.eventId,
        profileId: joining.profileId,
        role: joining.role,
        performerTag: joining.performerTag,
        // `invited`, the column's own default: being named on a bill somebody
        // else is drawing up is not the same as having agreed to play it.
        status: "invited",
        addedBy: principal.userId,
      })
      .returning();
    if (!participant) throw new Error("participant create failed");
    participantIdByProfile.set(joining.profileId, participant.id);

    await writeAudit(tx, request, {
      capability: "participants.manage",
      action: "participant.add",
      targetKind: "event_participant",
      targetId: participant.id,
      eventId: input.eventId,
      after: participant,
    });
    await writeActivity(tx, request, {
      eventId: input.eventId,
      type: "participant.added",
      targetKind: "event",
      targetId: input.eventId,
      summary: { profileId: participant.profileId, role: participant.role },
    });
    // The FUTURE-events rule (decisions #14) is a property of a performer
    // joining an event, not of the route they joined through — so it runs here
    // for the same reason it runs on `POST /events/:id/participants`.
    const [event] = await tx
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, input.eventId));
    if (event) await autoAssignAgentOnPerformerJoin(tx, event, participant.profileId);
  }
  return participantIdByProfile;
}

/** Write the stated agreement as a real `deals` + `deal_parties` record. */
async function createStatedDeal(
  tx: Transaction,
  request: FastifyRequest,
  input: {
    eventId: string;
    deal: CreateEventDealBody;
    currency: string;
    participantIdByProfile: ReadonlyMap<string, string>;
  },
): Promise<void> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const stated = input.deal;

  const [deal] = await tx
    .insert(schema.deals)
    .values({
      eventId: input.eventId,
      type: stated.type,
      structure: stated.structure,
      name: stated.name,
      // The event's base currency IS the payout currency of a deal stated while
      // the event is being created — there is not yet a second one to choose.
      currency: input.currency,
      guaranteeAmount: stated.guaranteeAmount != null ? BigInt(stated.guaranteeAmount) : undefined,
      advanceAmount: stated.advanceAmount != null ? BigInt(stated.advanceAmount) : undefined,
      splitBasisPoints: stated.splitBasisPoints,
      paymentTiming: stated.paymentTiming,
      // `status` stays the column default (`draft`): terms one side typed are a
      // proposal until the parties confirm them.
      createdBy: principal.userId,
    })
    .returning();
  if (!deal) throw new Error("deal create failed");

  const parties = await tx
    .insert(schema.dealParties)
    .values(
      stated.parties.map((party) => {
        const participantId = input.participantIdByProfile.get(party.profileId);
        if (!participantId) throw new Error("deal party participant missing");
        return {
          dealId: deal.id,
          participantId,
          roleInDeal: party.roleInDeal,
          share: party.share ?? null,
        };
      }),
    )
    .returning();

  await writeAudit(tx, request, {
    capability: "deal.edit",
    action: "deal.create",
    targetKind: "deal",
    targetId: deal.id,
    eventId: input.eventId,
    after: serializeDealUnredacted(deal, parties),
  });
  await writeActivity(tx, request, {
    eventId: input.eventId,
    type: "deal.created",
    targetKind: "deal",
    targetId: deal.id,
    summary: { name: deal.name, type: deal.type },
  });
}

const CreateEventBody = z.object({
  title: z.string().min(1),
  baseCurrency: z.string().min(1),
  eventDate: z.string().optional(),
  doorTime: LocalTime.optional(),
  startTime: LocalTime.optional(),
  endTime: LocalTime.optional(),
  curfew: LocalTime.optional(),
  venueProfileId: z.string().uuid().optional(),
  venueName: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(),
  stageId: z.string().uuid().optional(),
  notes: z.string().optional(),
  extras: EventExtrasSchema.optional(),
  ...EventImageFields,
  /** Explicit IANA zone override; otherwise snapshotted from the venue (decisions #10). */
  timezone: z.string().optional(),
  /** Profiles joining the bill with the event — see the block above. */
  participants: z.array(CreateEventParticipant).optional(),
  /** The agreement stated while creating the event — see the block above. */
  deal: CreateEventDeal.optional(),
});

const UpdateEventBody = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  status: z
    .enum(["draft", "suggested", "pending", "confirmed", "on_hold", "concluded", "cancelled"])
    .optional(),
  published: z.boolean().optional(),
  eventDate: z.string().nullable().optional(),
  doorTime: LocalTime.nullable().optional(),
  startTime: LocalTime.nullable().optional(),
  endTime: LocalTime.nullable().optional(),
  curfew: LocalTime.nullable().optional(),
  venueProfileId: z.string().uuid().nullable().optional(),
  venueName: z.string().nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  stageId: z.string().uuid().nullable().optional(),
  extras: EventExtrasSchema.nullable().optional(),
  ...EventImageFields,
  timezone: z.string().optional(),
  /** Expected version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const EventResponse = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  published: z.boolean(),
  baseCurrency: z.string(),
  eventDate: z.string().nullable(),
  doorTime: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  curfew: z.string().nullable(),
  timezone: z.string().nullable(),
  hostProfileId: z.string(),
  venueProfileId: z.string().nullable(),
  venueName: z.string().nullable(),
  capacity: z.number().nullable(),
  stageId: z.string().nullable(),
  notes: z.string().nullable(),
  /** Signed per response when the poster is an upload — never a stored value. */
  imageUrl: z.string().nullable(),
  version: z.number(),
  /** The caller's OWN effective capabilities here — what the workspace may offer. */
  capabilities: z.array(z.string()),
  holdRank: z.number().nullable().optional(),
  holdAutoPromote: z.boolean().optional(),
  extras: EventExtrasSchema.nullable().optional(),
});

/**
 * What an archive/unarchive call answers with — the caller's OWN filing state,
 * not the event's. Deliberately NOT an `EventResponse`: nothing about the event
 * changed, so echoing the whole event back would invite the reader to believe
 * something did.
 */
const ArchiveResponse = z.object({
  id: z.string(),
  archived: z.boolean(),
  archivedAt: z.string().nullable(),
});

const OPERATOR_CAPABILITIES = new Set(PRESET_PERMISSION_SETS.operator_full as Capability[]);

// ── Venue-profile prefill ────────────────────────────────────────────────────
//
// Placing an event at a venue profile used to carry exactly ONE fact across: the
// timezone (`resolveEventTimezone`). Everything else the venue had already
// written down about itself — its name, its capacity, its house curfew, its
// amenities, the city it stands in — was re-typed onto every event, which is the
// complaint the venue_details table (migration 0010) was built to end.
//
// It is a SUGGESTION, not a sync. A field is only ever filled when it is BLANK:
// blank in this request and blank on the event. Anything the operator typed —
// including a "(Back Room)" venue name that differs from the profile's, or a
// capacity reduced for a seated layout — stands, and stays theirs. The venue is
// also free to change its own profile afterwards; the event keeps the figure it
// was booked on, exactly as `timezone` is a snapshot rather than a live read.

/** The facts a venue profile lends an event placed there. */
interface VenueProfileDefaults {
  venueName: string | null;
  capacity: number | null;
  curfew: string | null;
  amenities: string[];
  city: string | null;
  country: string | null;
}

/** The event fields a venue profile can fill in — on the row and in `extras`. */
interface VenueFillableFields {
  venueName?: string | null;
  capacity?: number | null;
  curfew?: string | null;
  extras?: EventExtras | null;
}

/** Blank means "nothing there to protect": unset, cleared, or whitespace. */
function isBlank(value: string | number | null | undefined): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

/**
 * Read a venue profile's own record of itself. Null when the profile is gone —
 * the caller then writes what it was given and nothing more, because a missing
 * venue must never fail an event the operator is otherwise entitled to create.
 */
async function loadVenueProfileDefaults(
  tx: Transaction,
  venueProfileId: string,
): Promise<VenueProfileDefaults | null> {
  const [profile] = await tx
    .select({ name: schema.profiles.name })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, venueProfileId));
  if (!profile) return null;

  const [details] = await tx
    .select()
    .from(schema.venueDetails)
    .where(eq(schema.venueDetails.profileId, venueProfileId));
  const [location] = await tx
    .select({ city: schema.profileLocations.city, country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(eq(schema.profileLocations.profileId, venueProfileId))
    .orderBy(desc(schema.profileLocations.isPrimary))
    .limit(1);

  return {
    venueName: profile.name,
    capacity: details?.capacity ?? null,
    // `venue_details.curfew` is free text ("02:00", but a venue may write
    // anything) and `events.curfew` is a `time` column. Only a value the column
    // can actually hold travels; the rest is left for a human to read on the
    // profile rather than crashing an event create.
    curfew: details?.curfew && LocalTime.safeParse(details.curfew).success ? details.curfew : null,
    amenities: details?.amenities ?? [],
    city: location?.city ?? null,
    country: location?.country ?? null,
  };
}

/**
 * The subset of `defaults` that fills genuine blanks — nothing else. `provided`
 * is what this request carries, `current` what the event already holds (empty on
 * create). Returns only the fields to write, so a caller can spread it over its
 * own values without re-deciding anything.
 */
function venuePrefill(
  defaults: VenueProfileDefaults,
  provided: VenueFillableFields,
  current: VenueFillableFields,
): VenueFillableFields {
  const fill: VenueFillableFields = {};

  if (isBlank(provided.venueName) && isBlank(current.venueName) && defaults.venueName) {
    fill.venueName = defaults.venueName;
  }
  if (provided.capacity == null && current.capacity == null && defaults.capacity != null) {
    fill.capacity = defaults.capacity;
  }
  if (isBlank(provided.curfew) && isBlank(current.curfew) && defaults.curfew) {
    fill.curfew = defaults.curfew;
  }

  // `extras` is written whole, so the merge base is whichever version this
  // request will persist: the body's if it sent one, otherwise the stored one.
  const base: EventExtras = { ...(current.extras ?? {}), ...(provided.extras ?? {}) };
  const extras: EventExtras = { ...base };
  let extrasChanged = false;

  const currentAmenities = Array.isArray(base.amenities) ? base.amenities : [];
  if (currentAmenities.length === 0 && defaults.amenities.length > 0) {
    extras.amenities = [...defaults.amenities];
    extrasChanged = true;
  }
  // The event has no location column of its own — the venue IS the location, and
  // `extras.city` is where the create wizard has always written the city line.
  if (isBlank(base.city as string | undefined) && defaults.city) {
    extras.city = defaults.city;
    extrasChanged = true;
  }
  if (isBlank(base.country as string | undefined) && defaults.country) {
    extras.country = defaults.country;
    extrasChanged = true;
  }
  if (extrasChanged) fill.extras = extras;

  return fill;
}

// ── Archiving ────────────────────────────────────────────────────────────────
//
// Archiving is FILING, not a status, and not a state of the event at all.
//
// `events.status` says where the booking got to; archiving says whether the party
// doing the filing still wants to look at it. A concluded show and a cancelled
// one are both worth filing away, and filing must not overwrite the word that
// says which — so `archived` is deliberately NOT a value in the `event_status`
// enum. It is `event_participants.archived_at` (migration 0020).
//
// On the PARTICIPANT, not on the event, because an operator's filing preference
// is not a fact about anybody else's calendar (`docs/story.md`: the performer's
// world is "my bookings, my availability, my riders, my money"). Each profile
// archives its own row; every other party keeps the show on their list. The old
// app put a boolean on the event document and hid it from everyone on it.
//
// The gate is `event.view`, and that is the whole rule. The row being written is
// the caller's own participation, and the authority needed to have this event in
// your list in the first place IS `event.view` — so anyone who can see it may
// decide to stop looking at it. Requiring `event.edit` would mean a `view_only`
// collaborator or a crew member could never tidy their own list, to nobody's
// benefit: their filing is invisible to everyone else by construction. No new
// capability was invented, because the existing vocabulary already had the right
// word.
//
// It costs nothing and frees nothing. The free-tier event cap counts
// `events.status IN ('confirmed','concluded')` for the HOST profile
// (`CAP_COUNTING_EVENT_STATUSES` in `lib/entitlements.ts`); these routes never
// touch `events`, so an operator cannot archive a confirmed show to release a
// plan slot. That is a property of where the column lives, not a rule anyone has
// to remember to apply — and `events-archive.test.ts` fails loudly if it changes.

/**
 * The acting profile's own participant row on this event — the row an archive
 * writes to.
 *
 * The acting profile, not "any row the caller can reach": a user who belongs to
 * both the venue and the promoter on one show has two filing cabinets, and the
 * `X-Profile-Id` they are working as says which one they are tidying. `removed`
 * rows are excluded for the same reason `authorize()` excludes them — a
 * participation that has ended is not one you file away.
 */
async function actingParticipantOnEvent(
  request: FastifyRequest,
  eventId: string,
): Promise<typeof schema.eventParticipants.$inferSelect> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const actingProfileId = principal.actingProfileId;
  const membership = principal.memberships.find(
    (candidate) => candidate.profileId === actingProfileId,
  );
  if (!actingProfileId || !membership) {
    throw badRequest("Set X-Profile-Id to a profile you belong to");
  }

  const [participant] = await request.server.database
    .select()
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.profileId, actingProfileId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );
  if (!participant) {
    // Reachable through another of the caller's profiles, but not through this
    // one — so there is no row of THEIRS to file. Naming the header is the only
    // useful thing to say, because switching profile is the fix.
    throw badRequest("Set X-Profile-Id to a profile that is on this event");
  }
  return participant;
}

export async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Create: operator-kind gate + idempotency (decisions #8) + audit. No event-cap
  // gate here BY CONSTRUCTION: `CreateEventBody` carries no `status`, so a new event
  // always lands on the column default (`draft`) — outside the counted set. The cap
  // is charged where an event actually goes live (PATCH below / the hold paths).
  app.post(
    "/events",
    { schema: { body: CreateEventBody, response: { 201: EventResponse } } },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const actingProfileId = principal.actingProfileId;
      const membership = principal.memberships.find((m) => m.profileId === actingProfileId);
      if (!actingProfileId || !membership) {
        throw badRequest("Set X-Profile-Id to a profile you belong to");
      }
      if (membership.kind !== "operator") {
        throw forbidden("Only operator profiles can create events");
      }
      const { database } = request.server;

      // The bill and the agreement, checked BEFORE anything is written. The
      // creator is the host of the event it is creating and receives the
      // `operator_full` set in this same transaction, which carries both
      // `participants.manage` and `deal.edit` — there is no earlier event to
      // authorize against, so the gate is the operator-kind check above plus
      // the fact that these rows can only ever be the caller's own event's.
      const joiningProfileIds = [
        ...new Set((request.body.participants ?? []).map((party) => party.profileId)),
      ];
      if (joiningProfileIds.includes(actingProfileId)) {
        throw badRequest("The host is already on the event and cannot be added again");
      }
      if (joiningProfileIds.length > 0) {
        const found = await database
          .select({ id: schema.profiles.id })
          .from(schema.profiles)
          .where(inArray(schema.profiles.id, joiningProfileIds));
        if (found.length !== joiningProfileIds.length) {
          throw badRequest("Every participant must be a profile that exists");
        }
      }
      if (request.body.deal) {
        assertDealIsSettleable(
          request.body.deal,
          request.body.baseCurrency,
          new Set([actingProfileId, ...joiningProfileIds]),
        );
      }

      // Whom to tell, once the transaction has actually committed. Empty on an
      // idempotent replay, because the closure below does not run a second time
      // — a retried create must not re-announce itself.
      let joinedProfileIds: string[] = [];

      const { statusCode, body } = await withIdempotency(request, "POST /events", async () => {
        const created = await database.transaction(async (tx) => {
          const [permissionSet] = await tx
            .insert(schema.permissionSets)
            .values({
              profileId: actingProfileId,
              name: "operator_full",
              capabilities: [...PRESET_PERMISSION_SETS.operator_full],
            })
            .returning();
          const timezone = await resolveEventTimezone(
            tx,
            request.body.venueProfileId,
            request.body.timezone,
          );
          // The venue's own facts fill whatever this request left blank — see
          // the prefill block above for why it can only ever fill a blank.
          const defaults = request.body.venueProfileId
            ? await loadVenueProfileDefaults(tx, request.body.venueProfileId)
            : null;
          const fromVenue = defaults ? venuePrefill(defaults, request.body, {}) : {};
          // The poster must be a file THIS profile uploaded, into its own storage
          // folder. Without the check an operator could point their show at a
          // file id belonging to another profile and publish a picture out of
          // somebody else's folder — the same rule, and the same helper, that
          // guards a profile's avatar.
          await assertEventImageFile(tx, actingProfileId, request.body.imageFileId);

          const [event] = await tx
            .insert(schema.events)
            .values({
              hostProfileId: actingProfileId,
              title: request.body.title,
              baseCurrency: request.body.baseCurrency,
              eventDate: request.body.eventDate,
              doorTime: request.body.doorTime,
              startTime: request.body.startTime,
              endTime: request.body.endTime,
              curfew: request.body.curfew,
              venueProfileId: request.body.venueProfileId,
              venueName: request.body.venueName,
              capacity: request.body.capacity,
              stageId: request.body.stageId,
              notes: request.body.notes,
              extras: request.body.extras,
              imageFileId: request.body.imageFileId,
              imageUrl: request.body.imageUrl,
              ...fromVenue,
              timezone,
              createdBy: principal.userId,
            })
            .returning();
          if (!event || !permissionSet) throw new Error("event create failed");
          const [hostParticipant] = await tx
            .insert(schema.eventParticipants)
            .values({
              eventId: event.id,
              profileId: actingProfileId,
              role: "host",
              permissionSetId: permissionSet.id,
              status: "confirmed",
            })
            .returning();
          if (!hostParticipant) throw new Error("host participant create failed");
          // The host's own budget, opened with the event. Provisioning also runs
          // lazily on the first budget read (which is what heals events made
          // before this existed), but doing it here means a brand-new event is
          // already complete rather than complete-once-someone-looks.
          await tx
            .insert(schema.budgets)
            .values({ eventId: event.id, scope: "private", ownerProfileId: actingProfileId })
            .onConflictDoNothing();
          await writeAudit(tx, request, {
            capability: "event.edit",
            action: "event.create",
            targetKind: "event",
            targetId: event.id,
            eventId: event.id,
            after: event,
          });
          // The first line of the event's story. Only the host can read it today,
          // but everyone added later reads it as the beginning of the history.
          await writeActivity(tx, request, {
            eventId: event.id,
            type: "event.created",
            targetKind: "event",
            targetId: event.id,
            summary: { status: event.status },
          });

          // The rest of the bill, and the agreement stated over it — written
          // AFTER the event's own history line, so the story reads in the order
          // it happened. Same transaction on purpose: a deal whose parties are
          // half-written is not a deal, and a wizard that reported success on
          // the event while dropping the terms is the bug this closes.
          const participantIdByProfile = await joinParticipants(tx, request, {
            eventId: event.id,
            hostParticipantId: hostParticipant.id,
            hostProfileId: actingProfileId,
            participants: request.body.participants ?? [],
          });
          if (request.body.deal) {
            await createStatedDeal(tx, request, {
              eventId: event.id,
              deal: request.body.deal,
              currency: request.body.baseCurrency,
              participantIdByProfile,
            });
          }
          joinedProfileIds = joiningProfileIds;
          return event;
        });
        const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
          created.imageFileId,
        ]);
        return {
          statusCode: 201,
          body: serializeEvent(created, OPERATOR_CAPABILITIES, imageUrls),
        };
      });

      // Being added to somebody's bill is news. Best-effort and after the
      // commit, exactly as `POST /events/:id/participants` does it: a delivery
      // failure must never undo an event that is already created.
      for (const profileId of joinedProfileIds) {
        try {
          await notifyProfileMembers(database, profileId, principal.userId, {
            type: "event.participant_added",
            title: `Added to "${body.title}"`,
            body: `You were added to "${body.title}".`,
            eventId: body.id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${body.id}`,
            metadata: { eventId: body.id },
          });
        } catch (error) {
          request.log.error(
            { error, eventId: body.id, profileId },
            "participant-add notification failed",
          );
        }
      }

      return reply.status(statusCode as 201).send(body);
    },
  );

  // Read: authorize `event.view`, then serialize by the caller's capabilities.
  app.get(
    "/events/:id",
    { schema: { params: EventParams, response: { 200: EventResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.view");
      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      // An uploaded poster is bytes in a private bucket, so what goes on the wire
      // is a URL signed for this response — see `serialize/image.ts`.
      const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
        event.imageFileId,
      ]);
      return serializeEvent(event, capabilities, imageUrls);
    },
  );

  // Write: authorize `event.edit`, optimistic-lock on version, mutate + audit.
  app.patch(
    "/events/:id",
    { schema: { params: EventParams, body: UpdateEventBody, response: { 200: EventResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.edit");
      const [before] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!before) throw notFound("Event not found");

      const { expectedVersion, timezone: bodyTimezone, ...fields } = request.body;

      // Entitlement gate (decisions #4/§C, PLAN.md:613): moving an event INTO the
      // counted set (confirmed|concluded) consumes the free-tier event cap — every
      // such transition, not just `confirmed` (audit A-20). One shared helper, so
      // this path and the hold paths can never drift. Composed AFTER authorization,
      // never conflated with it.
      await assertEventCapAllows(database, before, fields.status);

      // The poster is checked against the event's HOST, not the caller's acting
      // profile: an agent or a co-host may hold `event.edit` here, and the file
      // that ends up on the row has to live in the folder the event belongs to.
      await assertEventImageFile(database, before.hostProfileId, fields.imageFileId);

      // A-22's preconditions live on `POST /events/:id/publish`, which is the
      // audited path and the one that writes an `event.published` history line.
      // This route accepted `published: true` on a draft and set the flag —
      // never an EXPOSURE (the read gate in routes/public.ts is the single gate,
      // exactly as A-22 designed) but publishing intent could be recorded by a
      // route that never checked it, and the bill would see no "published" line.
      // The status a caller is moving TO in this same request is what counts, so
      // confirming and publishing in one PATCH is allowed.
      if (fields.published === true && before.published !== true) {
        const nextStatus = fields.status ?? before.status;
        const nextDate = fields.eventDate !== undefined ? fields.eventDate : before.eventDate;
        if (nextStatus !== "confirmed") {
          throw badRequest(`Only a confirmed event can be published (this one is ${nextStatus})`);
        }
        if (!nextDate) throw badRequest("An event needs a date before it can be published");
      }

      const where =
        expectedVersion != null
          ? and(eq(schema.events.id, id), eq(schema.events.version, expectedVersion))
          : eq(schema.events.id, id);

      const updated = await database.transaction(async (tx) => {
        // Re-snapshot the timezone when the venue changes or an explicit zone is given
        // (decisions #10). Untouched otherwise — a title edit never re-resolves it.
        const reTimezone =
          fields.venueProfileId !== undefined || bodyTimezone !== undefined
            ? await resolveEventTimezone(
                tx,
                fields.venueProfileId ?? before.venueProfileId,
                bodyTimezone,
              )
            : undefined;

        // Placing the event at a venue is the moment its facts become relevant,
        // so the same fill-the-blanks pass runs here — but measured against the
        // event as it stands, so a value already on the row is never touched.
        const nextVenueProfileId = fields.venueProfileId;
        const defaults = nextVenueProfileId
          ? await loadVenueProfileDefaults(tx, nextVenueProfileId)
          : null;
        const fromVenue = defaults
          ? venuePrefill(defaults, fields, {
              venueName: before.venueName,
              capacity: before.capacity,
              curfew: before.curfew,
              extras: (before.extras as EventExtras | null) ?? null,
            })
          : {};

        const [after] = await tx
          .update(schema.events)
          .set({
            ...fields,
            ...fromVenue,
            ...(reTimezone !== undefined ? { timezone: reTimezone } : {}),
            version: before.version + 1,
            updatedAt: new Date(),
          })
          .where(where)
          .returning();
        if (!after) {
          // The row exists (checked above) but the version moved → conflict.
          throw conflict("Event was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "event.update",
          targetKind: "event",
          targetId: id,
          eventId: id,
          before,
          after,
        });

        // History, not audit: a PATCH that changed nothing is a real request the
        // audit trail must keep, and a line the timeline must not grow — the web
        // app saves the whole form, so most fields arrive unchanged every time.
        // What the venue filled in counts as changed too — an operator reading
        // the timeline must see that the capacity moved, not just the venue.
        const changed = changedFieldNames(before, { ...fields, ...fromVenue });
        if (changed.length > 0) {
          // A status move is the headline (`draft` → `confirmed` is the booking
          // itself), so it gets its own type and carries its values: `status` is
          // event-public in `serialize/event.ts`. Every other field is named but
          // not valued — `extras` is the operator's guest list.
          const statusChanged = changed.includes("status");
          await writeActivity(tx, request, {
            eventId: id,
            type: statusChanged ? "event.status_changed" : "event.updated",
            targetKind: "event",
            targetId: id,
            summary: statusChanged
              ? { from: before.status, to: after.status, fields: changed }
              : { fields: changed },
          });
        }
        return after;
      });

      const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
        updated.imageFileId,
      ]);
      return serializeEvent(updated, capabilities, imageUrls);
    },
  );

  // Archive: file this event away for the ACTING PROFILE only. See the block
  // above `actingParticipantOnEvent` for why this is not a status, why it lives
  // on the participant, why `event.view` is the gate, and why it cannot move a
  // plan slot.
  app.post(
    "/events/:id/archive",
    { schema: { params: EventParams, response: { 200: ArchiveResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.view");
      const participant = await actingParticipantOnEvent(request, id);

      // Already filed. Answering with the state that holds keeps a double click,
      // a retry and a stale UI all harmless — and writes no second history line
      // for a thing that did not happen twice.
      if (participant.archivedAt) {
        return { id, archived: true, archivedAt: participant.archivedAt.toISOString() };
      }

      const actorUserId = request.principal?.userId;
      const updated = await database.transaction(async (tx) => {
        const now = new Date();
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({ archivedAt: now, archivedBy: actorUserId, updatedAt: now })
          .where(eq(schema.eventParticipants.id, participant.id))
          .returning();
        if (!after) throw notFound("Event not found");

        await writeAudit(tx, request, {
          capability: "event.view",
          action: "event.archive",
          targetKind: "event_participant",
          targetId: participant.id,
          eventId: id,
          before: participant,
          after,
        });
        // History, scoped to the one participant it is about (`archive` is a
        // participant-scoped activity kind — see `lib/activity.ts`). An operator
        // reading "why is this not in my list?" gets an answer; the performer on
        // the bill is not told the operator has stopped looking, because that is
        // the operator's filing and not news about the show.
        await writeActivity(tx, request, {
          eventId: id,
          type: "event.archived",
          targetKind: "archive",
          targetId: participant.id,
        });
        return after;
      });

      return { id, archived: true, archivedAt: updated.archivedAt?.toISOString() ?? null };
    },
  );

  // Unarchive: put it back. Archiving is reversible BY CONSTRUCTION — the column
  // is nullable and nothing else was touched — so this route restores exactly the
  // state that existed before, with no reconstruction and nothing to lose.
  app.post(
    "/events/:id/unarchive",
    { schema: { params: EventParams, response: { 200: ArchiveResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.view");
      const participant = await actingParticipantOnEvent(request, id);

      if (!participant.archivedAt) {
        return { id, archived: false, archivedAt: null };
      }

      await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
          .where(eq(schema.eventParticipants.id, participant.id))
          .returning();
        if (!after) throw notFound("Event not found");

        await writeAudit(tx, request, {
          capability: "event.view",
          action: "event.unarchive",
          targetKind: "event_participant",
          targetId: participant.id,
          eventId: id,
          before: participant,
          after,
        });
        await writeActivity(tx, request, {
          eventId: id,
          type: "event.unarchived",
          targetKind: "archive",
          targetId: participant.id,
        });
      });

      return { id, archived: false, archivedAt: null };
    },
  );
}
