import { PERFORMING_EVENT_ROLES, PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { eventParticipantRecipients, notifyProfileMembers, notifyUsers } from "@showme/db/notify";
import {
  type Capability,
  type DealDraft,
  WHOLE_VENUE,
  basisPointsToPercent,
  dealDraftProblems,
  guestListProblem,
  isDateTaken,
  minorToDecimalString,
  occupiedDates,
} from "@showme/shared";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { changedFieldNames, writeActivity } from "../lib/activity";
import {
  type AgentAssignment,
  autoAssignAgentOnPerformerJoin,
  notifyAgentsOfAssignment,
} from "../lib/agent-assignment";
import type { Transaction } from "../lib/audit";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import { assertEventCapAllows } from "../lib/entitlements";
import { eventChangeNotice } from "../lib/event-change-notice";
import {
  BOOKING_PARTY_ROLES,
  NEGOTIATED_FIELDS,
  type NegotiatedValues,
  answerChangeRequest,
  callerParticipantOrNull,
  changeNeedsAgreement,
  closeChangeRequestsOnCancel,
  counterpartCount,
  hasAnswered,
  isEmptyChange,
  negotiatedChanges,
  notifyBillChangeApplied,
  notifyProposer,
  openChangeRequest,
  proposeEventChange,
  reopenInvitationsAfterChange,
} from "../lib/event-change-requests";
import { notifyPublicationChanged } from "../lib/event-publication";
import { advanceEventStatus } from "../lib/event-status-ladder";
import { resolveEventTimezone } from "../lib/event-timezone";
import { movedHoldQueue, placeHoldInQueue, touchesHoldQueue } from "../lib/hold-queue";
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
 * The operator's guest list must fit the limits the same document states.
 *
 * The product owner's finding was that the two limits were *"only present but
 * don't actually work"*: they persisted, and nothing read them — not the add
 * form, and not this API, which took two free numbers and never compared them to
 * the `guests` array beside them. A limit only the form respects is not a limit.
 *
 * The rule itself is in `@showme/shared` so the card can refuse before it writes
 * and say exactly the same sentence; this is the authority. **400, not 409**: the
 * request body is what is wrong — it describes a list that breaks its own stated
 * limits — which is `badRequest`'s meaning, and unlike the settlement's stored-
 * state conflicts there is nothing on the server to go and fix first.
 *
 * `extras` is written WHOLE by both routes, so the body always carries the
 * complete document and this can be a pure check with no read behind it. That is
 * also what makes the lower-a-limit case fall out for free: lowering `limitTotal`
 * under a list that already breaks it arrives here as one document that does not
 * satisfy itself, and is refused with the overage named.
 */
function assertGuestListFitsItsLimits(
  extras: EventExtras | null | undefined,
  /**
   * The guest list already on the row, on the edit path. A request that leaves
   * everything the LIMITS ARE ABOUT untouched is not refused for it.
   *
   * `extras` is written whole, so every PATCH carries the guest list whether or
   * not it is what the operator came to change. Without this, a list stored
   * before the rule existed would block every later edit to the catering notes,
   * the amenities and the ticket tiers — a row nobody could get out of except by
   * fixing a guest list they did not come to fix.
   *
   * It is not a loophole. Such a list can only exist by having been written
   * before the rule, and the first request that moves a limit or a ticket count
   * is refused like any other. (Renaming a guest or writing a note passes,
   * correctly: neither is a thing a limit constrains.)
   */
  stored?: EventExtras["guestList"],
): void {
  const guestList = extras?.guestList;
  if (!guestList) return;
  if (stored !== undefined && limitRelevantShape(guestList) === limitRelevantShape(stored)) return;
  const problem = guestListProblem(guestList);
  if (problem) throw badRequest(problem);
}

/**
 * The part of a guest list the limits read: the two limits and each guest's
 * ticket count. Compared as a string rather than deep-equalled because a value
 * read back out of `jsonb` has its own key order, so the documents can be the
 * same fact and different bytes.
 */
function limitRelevantShape(guestList: EventExtras["guestList"]): string {
  return JSON.stringify([
    guestList?.limitTotal ?? null,
    guestList?.limitPerGuest ?? null,
    (guestList?.guests ?? []).map((guest) => [guest.id, guest.tickets]),
  ]);
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
    // The wizard states a simple deal and carries no ladder: a band and a bonus are
    // terms added on the Deals tab, where `DealTermsBody` accepts them. Empty here is
    // the truth about this body, not a placeholder.
    escalators: [],
    bonusThreshold: "",
    bonusAmount: "",
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
): Promise<{ participantIdByProfile: Map<string, string>; agents: AgentAssignment[] }> {
  const participantIdByProfile = new Map<string, string>([
    [input.hostProfileId, input.hostParticipantId],
  ]);
  /** Agents this join actually attached — reported out so they can be TOLD (QA4-7). */
  const agents: AgentAssignment[] = [];
  if (input.participants.length === 0) return { participantIdByProfile, agents };
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  /**
   * RUNG 1 OF THE BOOKING LADDER, on the path the wizard takes (ClickUp `86cbcehmp`).
   *
   * Ran: *"Inviting performers from the system in the flow or from the event manager
   * should move the event from draft to suggested"* — **both paths**, and this is the
   * first of them. The rung existed and fired only from
   * `POST /events/:id/participants`, which `apps/web` never calls: the wizard writes its
   * bill through here, so naming an act while creating a night left the event at
   * `draft` and the ladder's own comment blamed the resulting `draft`-with-invitations
   * rows on history.
   *
   * Once, not per performer. The ladder is forward-only and idempotent, so a loop would
   * be harmless — and it would read as though a second act could move the status again,
   * which is exactly the misreading this rung exists to prevent.
   */
  const invitesAnAct = input.participants.some((joining) =>
    PERFORMING_EVENT_ROLES.has(joining.role),
  );

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
    // `profile_id` is nullable since migration 0032 (an erased stub leaves a
    // name-only row), but a participant this code just inserted always has one —
    // the check is the type system's, and costs nothing.
    if (event && participant.profileId) {
      agents.push(...(await autoAssignAgentOnPerformerJoin(tx, event, participant.profileId)));
    }
  }
  if (invitesAnAct) {
    await advanceEventStatus(tx, { eventId: input.eventId, trigger: "performer_invited" });
  }

  return { participantIdByProfile, agents };
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
      // Both status columns stay on their defaults (`draft`): terms one side typed
      // are a proposal until the parties confirm them.
      //
      // The wizard no longer LEAVES it there. `agreement_status` moves draft →
      // sent from the client a few seconds later (`useDealAutoSend`), so the
      // operator states the terms once and the parties are asked to confirm —
      // and those few seconds are an Undo window in which nothing has yet been
      // said to anybody. The send stays `POST /deals/:did/send` rather than a
      // flag here ON PURPOSE: sending notifies the other parties, and a
      // notification is the one thing this route cannot take back if the
      // operator changes their mind.
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

/**
 * Who may ask whether a night at this venue is taken. Every member — the warning
 * is about the caller's own building, and an editor creating an event needs it
 * as much as an owner does. A viewer seeing "the 14th is busy" learns nothing
 * they could not read off the calendar they already have.
 */
const CONFLICT_READ_ROLES = ["owner", "admin", "editor", "viewer", "crew"] as const;

const DateConflictQuery = z.object({
  venueProfileId: z.string().uuid(),
  /** `yyyy-mm-dd` — the night being considered. */
  date: z.string().min(1),
  /** The room, when one has been picked. Absent asks about the venue entire. */
  stageId: z.string().uuid().optional(),
  /** The event being EDITED, so it does not warn about clashing with itself. */
  excludeEventId: z.string().uuid().optional(),
});

const DateConflictResponse = z.object({
  date: z.string(),
  /**
   * The answer, from `@showme/shared`'s rule rather than from counting rows: is
   * the room being asked about (or the venue entire) unable to take this night?
   * A venue with a free basement is NOT busy just because the main hall is sold.
   */
  roomIsBusy: z.boolean(),
  /** What is already on that night, so the warning can name it. */
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      stageId: z.string().nullable(),
      stageName: z.string().nullable(),
    }),
  ),
  /** Any manual block covering the date — the second half of Ran's report. */
  unavailability: z.array(
    z.object({
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});

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

const ProposeChangeBody = z.object({
  eventDate: z.string().nullable().optional(),
  venueProfileId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().nullable().optional(),
  /** Why they are asking, in their words — "we fly out that morning". */
  reason: z.string().trim().max(2000).optional(),
});

const ChangeAnswerParams = z.object({
  id: z.string().uuid(),
  crid: z.string().uuid(),
  answer: z.enum(["confirm", "decline"]),
});

const ChangeAnswerBody = z.object({ note: z.string().trim().max(2000).optional() });

const ChangeAnswerResponse = z.object({
  status: z.enum(["pending", "confirmed", "declined"]),
});

const ChangeRequestResponse = z.object({
  request: z
    .object({
      id: z.string(),
      changes: z.record(z.string(), z.string().nullable()),
      previous: z.record(z.string(), z.string().nullable()),
      reason: z.string().nullable(),
      createdAt: z.string(),
      /** How many counterparts must answer, and how many have. */
      required: z.number(),
      confirmed: z.number(),
      declined: z.number(),
      /** Whether THIS caller still has an answer to give. */
      answerable: z.boolean(),
    })
    .nullable(),
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
  /**
   * WHY THE SHOW IS OFF — read only when this PATCH moves `status` to
   * `cancelled`, and ignored otherwise (decisions #25.3: *"Cancel first (with a
   * reason, sent to the collaborators)"*).
   *
   * Optional here and REQUIRED BY THE DIALOG. Its whole purpose is to be sent, so
   * the screen keeps its confirm button disabled while it is blank
   * (`components/EventCancelModal.tsx`, the rule `DealReopenModal` already
   * follows). But the API must not refuse a cancellation for want of prose: a
   * called-off night is a fact about the world, and a 400 here would leave the
   * event standing as live on everybody's calendar. So a cancel with no reason
   * still cancels and still notifies — it just has nothing to explain itself with.
   *
   * It is NOT a column and NOT an `extras` leaf. It is written into the
   * `event.status_changed` activity summary, which `components/eventHistory.ts`
   * already renders as "Reason: …", and which is immutable and access-filtered.
   * `extras` is client-supplied wholesale on every PATCH, so a stamp there would
   * be both forgeable and losable on the next save.
   */
  cancellationReason: z.string().trim().max(2000).optional(),
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
  /**
   * The venue profile's primary location — the address and country the event
   * shows (ClickUp `123qy9rnfab`). Null when the venue is free text with no
   * profile behind it, or when the profile has answered no address.
   */
  venueLocation: z
    .object({
      street: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  /** The venue's public slug, so "Go to profile" has an address (`123qy9rnfab`). */
  venueSlug: z.string().nullable(),
  capacity: z.number().nullable(),
  stageId: z.string().nullable(),
  /** The name of that one room, so the page need not read the venue's whole list. */
  stageName: z.string().nullable(),
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
//
// COPY, NEVER LINK — and that is a domain rule, not an implementation shortcut.
// An agreement freezes at confirmation, so a venue that sells its PA in March
// must not rewrite what it promised in January. There is deliberately no live
// read of `venue_details` anywhere on the event's read path.
//
// What travels was widened on 2026-08-27 (ClickUp 86cbaxvku) from
// name/capacity/curfew/amenities/city to also carry the four things the venue
// had written down and the operator was still retyping every time: its house PA,
// its catering, its accommodation and its artist load-in notes. Each copy leaves
// a receipt in `extras.venueCarryOver` naming what arrived that way, because a
// value that silently appeared and cannot be explained is worse than a blank
// field — the event screen reads that stamp to say where these came from, and to
// take them back off again.

/** The facts a venue profile lends an event placed there. */
interface VenueProfileDefaults {
  venueName: string | null;
  capacity: number | null;
  curfew: string | null;
  amenities: string[];
  /**
   * The free-text leaves, keyed by the `extras` leaf each one lands on — the
   * city included, because an event has no location column and `extras.city` is
   * where the create wizard has always written the line.
   */
  notes: Partial<Record<VenueNoteLeaf, string | null>>;
}

/**
 * The `extras` leaves that are a straight copy of one free-text venue field.
 * `city` and `country` join them because the rule is identical — fill the leaf
 * when it is blank — and a sixth hand-written branch of the same `if` was five
 * chances to get one of them subtly wrong.
 */
const VENUE_NOTE_LEAVES = [
  "city",
  "country",
  "soundSystem",
  "cateringNotes",
  "accommodationNotes",
  "artistLogisticsNotes",
] as const;
type VenueNoteLeaf = (typeof VENUE_NOTE_LEAVES)[number];

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
    notes: {
      city: location?.city ?? null,
      country: location?.country ?? null,
      soundSystem: details?.soundSystem ?? null,
      cateringNotes: details?.cateringNotes ?? null,
      accommodationNotes: details?.accommodationNotes ?? null,
      // PRIVATE on the profile (decisions #16.7) and private here: `extras` is
      // only served to a caller holding `event.edit` (serialize/event.ts), so
      // copying the load-in note onto the event does not publish it.
      artistLogisticsNotes: details?.artistLogisticsNotes ?? null,
    },
  };
}

/**
 * The room's OWN capacity, when the event names one.
 *
 * A stage is a room, not a seating setup (`schema/events.ts`), so The Lantern
 * Hall's 400 is the wrong number for a show in its 80-capacity Back Room — and
 * capacity is not decoration: it caps the ticket inventory and draws the
 * break-even line. The more specific figure wins, and only ever into a blank.
 *
 * A stage belonging to a different venue returns null rather than throwing: the
 * mismatch is refused up front by `assertStageBelongsToVenue`, and a prefill
 * helper is the wrong place to have that argument twice.
 */
async function loadStageCapacity(
  tx: Transaction,
  venueProfileId: string,
  stageId: string,
): Promise<number | null> {
  const [stage] = await tx
    .select({ capacity: schema.stages.capacity })
    .from(schema.stages)
    .where(and(eq(schema.stages.id, stageId), eq(schema.stages.venueProfileId, venueProfileId)));
  return stage?.capacity ?? null;
}

/**
 * A show may only be put in a room of the venue it is at.
 *
 * `events.stage_id` has pointed at `stages` since migration 0000 with nothing
 * checking the pair, which was harmless while no route could set it and is not
 * now that the create wizard offers a Room picker. Naming another venue's room
 * would put a show in a building it is not in — and the calendar pools holds by
 * `(event_date, venue, stage)`, so it would also let a hold compete in a queue
 * it has no claim on.
 */
async function assertStageBelongsToVenue(
  tx: Transaction,
  venueProfileId: string | null | undefined,
  stageId: string,
): Promise<void> {
  if (!venueProfileId) {
    throw badRequest("Set the venue before choosing one of its rooms");
  }
  const [stage] = await tx
    .select({ id: schema.stages.id })
    .from(schema.stages)
    .where(and(eq(schema.stages.id, stageId), eq(schema.stages.venueProfileId, venueProfileId)));
  if (!stage) throw badRequest("That room does not belong to this venue");
}

/**
 * The subset of `defaults` that fills genuine blanks — nothing else. `provided`
 * is what this request carries, `current` what the event already holds (empty on
 * create). Returns only the fields to write, so a caller can spread it over its
 * own values without re-deciding anything.
 *
 * `stageCapacity` is the chosen room's own figure, which outranks the building's
 * where they differ — see `loadStageCapacity`.
 */
function venuePrefill(
  defaults: VenueProfileDefaults,
  provided: VenueFillableFields,
  current: VenueFillableFields,
  venueProfileId: string,
  stageCapacity: number | null = null,
): VenueFillableFields {
  const fill: VenueFillableFields = {};
  /** Every leaf this copy actually filled — the receipt written at the end. */
  const copied: string[] = [];

  if (isBlank(provided.venueName) && isBlank(current.venueName) && defaults.venueName) {
    fill.venueName = defaults.venueName;
    copied.push("venueName");
  }
  const capacity = stageCapacity ?? defaults.capacity;
  if (provided.capacity == null && current.capacity == null && capacity != null) {
    fill.capacity = capacity;
    copied.push("capacity");
  }
  if (isBlank(provided.curfew) && isBlank(current.curfew) && defaults.curfew) {
    fill.curfew = defaults.curfew;
    copied.push("curfew");
  }

  // `extras` is written whole, so the merge base is whichever version this
  // request will persist: the body's if it sent one, otherwise the stored one.
  const base: EventExtras = { ...(current.extras ?? {}), ...(provided.extras ?? {}) };
  const extras: EventExtras = { ...base };

  const currentAmenities = Array.isArray(base.amenities) ? base.amenities : [];
  if (currentAmenities.length === 0 && defaults.amenities.length > 0) {
    extras.amenities = [...defaults.amenities];
    copied.push("amenities");
  }
  // The venue's own free text — its PA, its catering, its rooms, its load-in —
  // and the city it stands in, which is the event's only location: an event has
  // no location column, the venue IS the location.
  for (const leaf of VENUE_NOTE_LEAVES) {
    const offered = defaults.notes[leaf];
    if (isBlank(base[leaf] as string | undefined) && !isBlank(offered)) {
      extras[leaf] = offered;
      copied.push(leaf);
    }
  }

  if (copied.length === 0) return fill;

  // The receipt replaces any earlier one: an event moved from one room to
  // another was not lent these by the first venue, and a stale name on the
  // stamp would explain the values wrongly, which is worse than not explaining
  // them at all.
  extras.venueCarryOver = {
    profileId: venueProfileId,
    venueName: defaults.venueName ?? "",
    copiedAt: new Date().toISOString(),
    fields: copied,
  };
  fill.extras = extras;

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

      // Same rule as the PATCH: a show may not be BORN over its own guest-list
      // limits. One call site is no call sites.
      assertGuestListFitsItsLimits(request.body.extras);

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
      /** Agents the bill attached — told after the commit, never inside it (QA4-7). */
      let assignedAgents: AgentAssignment[] = [];

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
          // A show goes in a room of the venue it is at, or in no room at all.
          if (request.body.stageId) {
            await assertStageBelongsToVenue(tx, request.body.venueProfileId, request.body.stageId);
          }
          // The venue's own facts fill whatever this request left blank — see
          // the prefill block above for why it can only ever fill a blank.
          const venueProfileId = request.body.venueProfileId;
          const defaults = venueProfileId
            ? await loadVenueProfileDefaults(tx, venueProfileId)
            : null;
          const stageCapacity =
            venueProfileId && request.body.stageId
              ? await loadStageCapacity(tx, venueProfileId, request.body.stageId)
              : null;
          const fromVenue =
            defaults && venueProfileId
              ? venuePrefill(defaults, request.body, {}, venueProfileId, stageCapacity)
              : {};
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
          // THE NIGHT'S BOOK, opened with the event — the `shared` ledger, and only it.
          //
          // This used to open a PRIVATE book for the creating operator, which is the exact
          // shape `f996c14` and migration `0046` existed to remove, and it put every event
          // created after them straight back into it: two books on a night with nobody to
          // keep one from, a scope chooser offering a choice that can only be got wrong,
          // and the settlement reading only the other one. Measured by the QA sweep on
          // 2026-09-27 — a SEK 5,000 production cost typed into "My budget" settled as
          // "Deductions − SEK 0", and migration 0046 could not heal it because its guard is
          // "the event has no shared ledger yet".
          //
          // A private book is the margin line an operator keeps from a CO-operator, so it
          // comes into being when there is one. That rule lives in `ensureEventBudgets`
          // and stays there: provisioning runs on the first budget read, so a co-host who
          // joins later gets theirs without this path having to know.
          await tx
            .insert(schema.budgets)
            .values({ eventId: event.id, scope: "shared", ownerProfileId: null })
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
          const joined = await joinParticipants(tx, request, {
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
              participantIdByProfile: joined.participantIdByProfile,
            });
          }
          joinedProfileIds = joiningProfileIds;
          assignedAgents = joined.agents;
          return event;
        });
        const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
          created.imageFileId,
        ]);
        return {
          statusCode: 201,
          body: serializeEvent(
            created,
            OPERATOR_CAPABILITIES,
            imageUrls,
            undefined,
            undefined,
            await stageNameOf(database, created.stageId),
          ),
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

      // AND THE AGENTS the bill attached on their act's behalf (QA4-7). Not in the
      // loop above: `joinedProfileIds` is who was INVITED, and an auto-assigned agent
      // was never invited by anybody — which is exactly why they need telling.
      await notifyAgentsOfAssignment(
        database,
        request,
        { id: body.id, title: body.title },
        assignedAgents,
      );

      return reply.status(statusCode as 201).send(body);
    },
  );

  /**
   * The venue's primary location, for the address + country an event shows
   * (ClickUp `123qy9rnfab`).
   *
   * A separate small read rather than a join onto every event query: only the two
   * routes that serialize ONE event need it, the row is tiny, and widening the
   * list query's joins for a field the list does not render would be paying on
   * every page for something one screen uses.
   *
   * `is_primary` decides which of a profile's locations is "the address". A
   * profile with several and none marked primary has not answered the question,
   * and guessing (the first row, the most recently added) would show a different
   * address depending on insert order — so it shows none.
   */
  async function venueLocationOf(
    database: FastifyInstance["database"],
    venueProfileId: string | null,
  ) {
    if (!venueProfileId) return null;
    const [location] = await database
      .select({
        street: schema.profileLocations.street,
        city: schema.profileLocations.city,
        country: schema.profileLocations.country,
      })
      .from(schema.profileLocations)
      .where(
        and(
          eq(schema.profileLocations.profileId, venueProfileId),
          eq(schema.profileLocations.isPrimary, true),
        ),
      );
    return location ?? null;
  }

  /**
   * The venue's public SLUG — what "Go to profile" needs an address for (ClickUp
   * `123qy9rnfab`). The event stores an id, and a public profile page is reached
   * by slug (`/profile/<slug>`), so without this the menu has an option it cannot
   * act on.
   *
   * Null for an unlinked venue, exactly like the address: a free-text room name
   * has no profile to go to.
   */
  async function venueSlugOf(database: FastifyInstance["database"], venueProfileId: string | null) {
    if (!venueProfileId) return null;
    const [profile] = await database
      .select({ slug: schema.profiles.slug })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, venueProfileId));
    return profile?.slug ?? null;
  }

  /** The name of the one room the event stands in — see `SerializedEvent.stageName`. */
  async function stageNameOf(database: FastifyInstance["database"], stageId: string | null) {
    if (!stageId) return null;
    const [stage] = await database
      .select({ name: schema.stages.name })
      .from(schema.stages)
      .where(eq(schema.stages.id, stageId));
    return stage?.name ?? null;
  }

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
      return serializeEvent(
        event,
        capabilities,
        imageUrls,
        await venueLocationOf(database, event.venueProfileId),
        await venueSlugOf(database, event.venueProfileId),
        await stageNameOf(database, event.stageId),
      );
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

      // `cancellationReason` is pulled OUT of `fields`: `fields` is spread straight
      // into the `events` update below, and there is no such column — it is a
      // sentence about a transition, not a property of the event.
      const {
        expectedVersion,
        timezone: bodyTimezone,
        cancellationReason,
        ...fields
      } = request.body;

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

      // The guest list must fit the limits it states — see the helper for why
      // this is the whole document every time, and why lowering a limit under an
      // over-long list is refused here rather than stored and displayed.
      assertGuestListFitsItsLimits(fields.extras, (before.extras as EventExtras | null)?.guestList);

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

      /**
       * ── IS THIS AN EDIT, OR A QUESTION? (ClickUp 86cbcftg3) ──────────────
       *
       * Ran: *"When trying to change the date for an event the other side must
       * be notified"* — with Confirm/Decline once the booking is `pending` or
       * beyond, and the same treatment for the venue and the room.
       *
       * Below `pending` nobody has agreed to anything, so this falls through and
       * the PATCH applies as it always did — the re-asking of the invitation is
       * handled after the write, where the new date is known.
       *
       * From `pending` up, the negotiated fields are diverted into a proposal
       * and REMOVED from this patch, so the rest of the edit (a title, a door
       * time) still lands. Half-applying is the right answer here: refusing the
       * whole PATCH would make renaming a show impossible while a date question
       * was open.
       */
      const negotiated = negotiatedChanges(fields as Record<string, unknown>, {
        eventDate: before.eventDate,
        venueProfileId: before.venueProfileId,
        stageId: before.stageId,
      });
      /*
       * …AND THERE IS SOMEBODY TO ASK. An event whose only participant is the
       * operator has no counterparts, so the proposal was raised with `required:
       * 0`, nothing could answer it, and the only code that applies a change
       * (`answerChangeRequest`) never ran — the date could never move again, and
       * the pending row superseded every later attempt. That is the state every
       * event is in before anybody is invited to it.
       */
      const mustAsk =
        changeNeedsAgreement(before.status) &&
        !isEmptyChange(negotiated.changes) &&
        (await counterpartCount(database, id, request.principal?.userId ?? null)) > 0;
      if (mustAsk) {
        for (const field of NEGOTIATED_FIELDS) {
          delete (fields as Record<string, unknown>)[field];
        }
      }

      const where =
        expectedVersion != null
          ? and(eq(schema.events.id, id), eq(schema.events.version, expectedVersion))
          : eq(schema.events.id, id);

      /**
       * The fields this save actually moved, carried OUT of the transaction so the
       * notification can be sent after the commit — a delivery that cannot be taken back
       * must not sit inside a write that can (`86cbcftg3`).
       */
      let changedFields: string[] = [];

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

        // A show goes in a room of the venue it is at — checked against the
        // venue this PATCH leaves behind, not the one it started with.
        const venueAfter =
          fields.venueProfileId !== undefined ? fields.venueProfileId : before.venueProfileId;
        if (fields.stageId) await assertStageBelongsToVenue(tx, venueAfter, fields.stageId);

        // Placing the event at a venue is the moment its facts become relevant,
        // so the same fill-the-blanks pass runs here — but measured against the
        // event as it stands, so a value already on the row is never touched.
        const nextVenueProfileId = fields.venueProfileId;
        const defaults = nextVenueProfileId
          ? await loadVenueProfileDefaults(tx, nextVenueProfileId)
          : null;
        const stageAfter = fields.stageId !== undefined ? fields.stageId : before.stageId;
        const stageCapacity =
          nextVenueProfileId && stageAfter
            ? await loadStageCapacity(tx, nextVenueProfileId, stageAfter)
            : null;
        const fromVenue =
          defaults && nextVenueProfileId
            ? venuePrefill(
                defaults,
                fields,
                {
                  venueName: before.venueName,
                  capacity: before.capacity,
                  curfew: before.curfew,
                  extras: (before.extras as EventExtras | null) ?? null,
                },
                nextVenueProfileId,
                stageCapacity,
              )
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
        changedFields = changed;
        if (changed.length > 0) {
          // A status move is the headline (`draft` → `confirmed` is the booking
          // itself), so it gets its own type and carries its values: `status` is
          // event-public in `serialize/event.ts`. Every other field is named but
          // not valued — `extras` is the operator's guest list.
          /*
           * A CANCELLATION CLOSES THE QUESTIONS STILL OPEN ON THE NIGHT — QA sweep run 5
           * (QA5-2) and run 4 (QA4-16). A pending proposal asks the bill to agree a new
           * date for a show that is off; answering it either way means nothing. In the
           * same transaction as the cancellation, because a cancelled event with a live
           * proposal on it is the state this prevents.
           */
          if (after.status === "cancelled" && before.status !== "cancelled") {
            await closeChangeRequestsOnCancel(tx, id);
          }

          /*
           * A HOLD JOINING A QUEUE TAKES A NUMBER — QA sweep run 5 (QA5-4).
           *
           * A hold placed against a typed venue NAME is in no queue (the pool is keyed
           * on the venue PROFILE), so its own placement writes no rank; attaching the
           * venue here dropped it into a queue that already had a 1st, and `?? 1` then
           * read two holds as first with no screen able to break the tie. In the same
           * transaction as the edit that moved it, because a queue with two firsts in it
           * is the state this prevents. Details in `lib/hold-queue.ts`.
           */
          if (touchesHoldQueue(changed)) {
            /*
             * THE RESPONSE CARRIES THE RANK IT WROTE — QA sweep run 6 (QA6-5). The
             * update below is its own statement, so `after` still held the rank the row
             * had BEFORE it: the PATCH answered `"holdRank": null` on a hold Postgres
             * had just made 2nd, and a client rendering the mutation response rather
             * than refetching drew "1st hold" on a second hold.
             */
            const placed = await placeHoldInQueue(tx, after, {
              movedQueue: movedHoldQueue(changed),
            });
            if (placed !== null) after.holdRank = placed;
            else if (movedHoldQueue(changed) && after.holdRank !== null) {
              // It left a queue and joined an empty one, so its number went back to
              // NULL — the lone hold's own state (see `placeHoldInQueue`).
              const [reread] = await tx
                .select({ holdRank: schema.events.holdRank })
                .from(schema.events)
                .where(eq(schema.events.id, id));
              // Assigned only when the row was found — `?? after.holdRank` would read
              // the NULL this is here to report as "nothing came back" and keep the
              // stale number, which is the same bug one line further on.
              if (reread) after.holdRank = reread.holdRank;
            }
          }

          const statusChanged = changed.includes("status");
          await writeActivity(tx, request, {
            eventId: id,
            type: statusChanged ? "event.status_changed" : "event.updated",
            targetKind: "event",
            targetId: id,
            summary: statusChanged
              ? {
                  from: before.status,
                  to: after.status,
                  fields: changed,
                  // WHY THE NIGHT IS OFF, kept where it cannot be edited or lost
                  // (decisions #25.3). `components/eventHistory.ts` already prints any
                  // summary `reason` as "Reason: …", so the Event History tab shows it
                  // with no change of its own. Only on the cancel — a reason sent with
                  // any other transition is a field the writer misused, and recording
                  // it as the explanation for, say, a confirmation would be worse than
                  // dropping it.
                  ...(after.status === "cancelled" && cancellationReason
                    ? { reason: cancellationReason }
                    : {}),
                }
              : { fields: changed },
          });
        }
        return after;
      });

      // The negotiated half, AFTER the ordinary edit has landed (86cbcftg3).
      //
      // Outside the transaction on purpose: both branches notify people, and a
      // notification that cannot be taken back must not sit inside a write that
      // might still roll back. It is the same rule the invitation answer follows.
      if (mustAsk) {
        await proposeEventChange(request, {
          eventId: id,
          changes: negotiated.changes,
          previous: negotiated.previous,
        });
      } else if (!isEmptyChange(negotiated.changes)) {
        // Below `pending`: the change simply happened. Ran still wants the offer
        // re-asked — *"Edits the date on the old Incoming request and sends it
        // back into the list as 'Pending' (unread)"* — which for us means the
        // invitations on this event become unanswered again. A new night is a
        // new question, including for somebody who had already said no.
        await reopenInvitationsAfterChange(request, {
          eventId: id,
          changes: negotiated.changes,
        });
      }

      /**
       * SOMEBODY ELSE RENAMED THIS SHOW — tell the operator whose show it is.
       *
       * The title is not a negotiated field and should not become one:
       * `NEGOTIATED_FIELDS` is the date, the venue and the room because those are what
       * a party AGREED TO, and `lib/event-change-requests.ts` says plainly why the
       * title is not among them — *"putting a confirm step in front of renaming a show
       * would make the mechanism hated rather than respected"*. A co-operator may
       * rename the night they are co-promoting.
       *
       * What they may not do is rename it INVISIBLY. The title is the one identifying
       * fact of the event: it is on the performers' screens, on the public page, and in
       * every notification about the night. A co-host renamed the seeded show through
       * the API and the host learned nothing until they happened to reload (QA sweep,
       * 2026-09-27) — the change was in the timeline and nowhere a person would look.
       *
       * So: no gate, and no silence. Outside the transaction, like every other
       * notification here, and best-effort — a delivery failure must never undo an edit
       * that has already landed.
       */
      /**
       * THE SHOW IS OFF — tell everybody who was on it (decisions #25.3).
       *
       * A cancellation was, until now, a silent status move: it wrote a timeline row
       * and nothing else. The performer holding the date, the agent who placed them
       * and the crew booked for the load-in all kept a live show on their calendar
       * until they next opened the event — and #25.3 leans on this notification
       * specifically, because it is what lets the delete ladder give way on the
       * other-party clause. **Cancelling is the notification.**
       *
       * Hung off the TRANSITION rather than a `POST /events/:id/cancel`, because
       * `PATCH { status: "cancelled" }` already exists and is not going to stop
       * existing: a second route would mean two ways to cancel a show and only one of
       * them speaking. `before.status` is read from the row this request loaded, so a
       * PATCH that re-sends `cancelled` on an already-cancelled show says nothing.
       *
       * Everyone on the bill minus the actor (`eventParticipantRecipients`) — not
       * `notifyProfileMembers(host)`, which would tell the operator's own colleagues
       * and nobody else. Best-effort and outside the transaction, like every other
       * notification here.
       */
      /*
       * The PATCH is the THIRD door onto `events.published` (ClickUp `123qy9rpe3q`).
       * Every operator screen takes a page down this way, so the notifier is reached
       * from here too rather than only from the two dedicated routes — a rule hung on
       * one door is a rule the other doors skip in silence.
       */
      if (before.published !== updated.published) {
        await notifyPublicationChanged(database, request, updated, updated.published);
      }

      const nowCancelled = before.status !== "cancelled" && updated.status === "cancelled";
      if (nowCancelled) {
        try {
          const actorUserId = request.principal?.userId ?? null;
          const recipients = await eventParticipantRecipients(database, id, actorUserId);
          await notifyUsers(database, recipients, actorUserId, {
            type: "event.cancelled",
            title: `"${updated.title}" was cancelled`,
            // The reason IS the body when there is one. A cancellation with no
            // explanation still has to be delivered, so it says so rather than
            // arriving as an empty line — the reader then knows to go and ask.
            body: cancellationReason
              ? cancellationReason
              : "No reason was given. The show is off — ask the operator if you need to know why.",
            eventId: id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${id}`,
            metadata: { from: before.status, reason: cancellationReason ?? null },
          });
        } catch (error) {
          request.log.error({ error, eventId: id }, "event-cancelled notification failed");
        }
      }

      /**
       * TELL THE BILL WHAT CHANGED — ClickUp `86cbcftg3`, last line: *"the system should
       * always notify the users of any change — where it happened and by who."*
       *
       * This REPLACES a rename-only notice that went to the host profile alone. That one
       * existed because a co-host renaming somebody else's show was invisible (QA sweep,
       * 2026-09-27), and it left two holes: a PATCH that moved the door time, the
       * capacity, the curfew or the notes told nobody at all, and a PERFORMER whose show
       * was renamed was never told either, because the notice was addressed to the host.
       * One notice to everyone on the bill closes both, and sends one message per save
       * rather than two for a rename.
       *
       * `eventChangeNotice` decides what is worth saying: field NAMES and not values
       * (except the title, which is the event's identifying fact), nothing about a status
       * or a publish because those have their own notices above, and null when that
       * leaves nothing.
       *
       * The negotiated fields normally never reach here — a date, venue or room move on a
       * `pending`-or-beyond event is diverted into a change request — so this is the
       * ordinary-edit channel, and below `pending` it is also the one that says the date
       * moved.
       */
      const notice = eventChangeNotice(changedFields, {
        title: updated.title,
        previousTitle: before.title,
      });
      if (notice) {
        try {
          const actorUserId = request.principal?.userId ?? null;
          const recipients = await eventParticipantRecipients(database, id, actorUserId);
          await notifyUsers(database, recipients, actorUserId, {
            type: "event.updated",
            title: notice.title,
            body: notice.body,
            eventId: id,
            // WHO, which is the other half of Ran's sentence. The bell renders this
            // beside the message; the fields in the body are the WHERE.
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${id}`,
            metadata: { fields: notice.fields },
          });
        } catch (error) {
          request.log.error({ error, eventId: id }, "event-change notification failed");
        }
      }

      const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
        updated.imageFileId,
      ]);
      // The address travels on the PATCH response too — a save that moved the
      // venue must not answer with the old room's country still on screen. Same for
      // the room: picking one is a PATCH, and the field it re-renders is its name.
      return serializeEvent(
        updated,
        capabilities,
        imageUrls,
        await venueLocationOf(database, updated.venueProfileId),
        await venueSlugOf(database, updated.venueProfileId),
        await stageNameOf(database, updated.stageId),
      );
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

  /**
   * ── ASKING TO MOVE A NIGHT, FROM THE OTHER SIDE (ClickUp 86cbcftg3) ───────
   *
   * Ran, on reviewing the first version: *"you only look from the operator
   * side."* He was right, and this is the clearest case. Changing a booked date
   * went through `PATCH /events/:id`, which needs `event.edit` — a capability no
   * performer, agent or crew preset carries. Driven as each of them, all three
   * got a flat **403**. So an act who had to move a night — touring, illness, a
   * clash — had no path in the product at all; they could only message and hope
   * the operator did it for them.
   *
   * This is the mirror. Anyone STANDING on the event may ask; the same people who
   * would have had to answer the operator's proposal now answer theirs, through
   * the same confirm/decline route. Nothing about the resolution changes — only
   * who is allowed to raise the question.
   *
   * It is a separate route rather than a loosened `PATCH` on purpose. `event.edit`
   * is the right gate for *editing an event*, and an act must not acquire it to
   * ask a question: they would come away able to rename the show, move the door
   * time and rewrite the notes. Proposing is a different act from editing, so it
   * gets a different door.
   */
  app.post(
    "/events/:id/change-request",
    {
      schema: {
        params: EventParams,
        body: ProposeChangeBody,
        response: { 200: ChangeAnswerResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      // `event.view` and standing, NOT `event.edit`: the floor every participant
      // clears, and the one `callerParticipantOrNull` already means.
      await requireEventCapability(request, id, "event.view");
      // ...but standing alone is not enough to move a night. Crew are on the
      // event and have no say in when it happens (`BOOKING_PARTY_ROLES`), so the
      // question asked here is narrower than "are you on this event".
      const participant = await callerParticipantOrNull(request, id, BOOKING_PARTY_ROLES);
      if (!participant) {
        throw forbidden("Only the venue and the acts on the bill can ask to move this booking");
      }

      const [before] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!before) throw notFound("Event not found");

      const negotiated = negotiatedChanges(request.body as Record<string, unknown>, {
        eventDate: before.eventDate,
        venueProfileId: before.venueProfileId,
        stageId: before.stageId,
      });
      if (isEmptyChange(negotiated.changes)) {
        throw badRequest("Name a date, venue or room that is actually different");
      }
      if (!changeNeedsAgreement(before.status)) {
        // Below `pending` the booking is the operator's own draft or an
        // unanswered offer — there is nobody to negotiate with yet, and an act
        // cannot be standing on it in the first place.
        throw conflict("This booking is not agreed yet, so there is nothing to renegotiate");
      }

      await proposeEventChange(request, {
        eventId: id,
        changes: negotiated.changes,
        previous: negotiated.previous,
        reason: request.body.reason,
      });
      return { status: "pending" as const };
    },
  );

  /**
   * ── THE OPEN CHANGE PROPOSAL ON THIS EVENT (ClickUp 86cbcftg3) ───────────
   *
   * `null` when there is none, which is the ordinary case — the card only draws
   * when there is a question outstanding.
   *
   * Gated on `event.view` rather than anything narrower: everyone standing on the
   * event has an interest in knowing the night is being moved, even the parties
   * who are not the ones being asked (a crew member's call time depends on it).
   */
  app.get(
    "/events/:id/change-request",
    { schema: { params: EventParams, response: { 200: ChangeRequestResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      await requireEventCapability(request, id, "event.view");

      const open = await openChangeRequest(database, id);
      if (!open) return { request: null };

      // Can the CALLER answer it? The card needs this to decide between buttons
      // and a "waiting for them" line, and the answer is per-viewer: the operator
      // who proposed it sees the same row and must not be offered Confirm.
      // Gated on the derived counterpart set, not on a profile comparison: that
      // set already means "standing on the event and not the person who asked".
      const participant = await callerParticipantOrNull(request, id);
      const answerable =
        participant !== null &&
        open.partyIds.includes(participant.id) &&
        (await hasAnswered(database, open.id, participant.id)) === false;

      return {
        request: {
          id: open.id,
          changes: open.changes as Record<string, string | null>,
          previous: open.previous as Record<string, string | null>,
          reason: open.reason,
          createdAt: open.createdAt.toISOString(),
          required: open.required,
          confirmed: open.confirmed,
          declined: open.declined,
          answerable,
        },
      };
    },
  );

  /**
   * Answer it. One route, two verbs — the only difference is the word, and
   * splitting them would duplicate the whole resolution path for that word.
   *
   * Authorized by STANDING on the event, not by a capability: the person being
   * asked is a performer, and no performer preset carries `event.edit`. What
   * makes them entitled to answer is that they are on the bill and did not
   * propose it, which is exactly what `counterparts` already means.
   */
  app.post(
    "/events/:id/change-request/:crid/:answer",
    {
      schema: {
        params: ChangeAnswerParams,
        body: ChangeAnswerBody,
        response: { 200: ChangeAnswerResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, crid, answer } = request.params;
      await requireEventCapability(request, id, "event.view");

      const open = await openChangeRequest(database, id);
      if (!open || open.id !== crid) throw notFound("No open change request");

      const participant = await callerParticipantOrNull(request, id);
      if (!participant) throw forbidden("You are not on this event");
      if (!open.partyIds.includes(participant.id)) {
        /*
         * TWO REASONS, AND THE MESSAGE HAS TO PICK THE RIGHT ONE.
         *
         * Either they asked for it, or they are on the event without standing to
         * answer — crew have no vote on when the show happens, in either direction.
         * Both are "somebody else decides", and the comment here used to claim the
         * sentence said so; it actually named the reader as the proposer either way,
         * so a crew member declining somebody else's proposal was told they had made
         * it (measured 2026-09-26). A refusal that misdescribes what you did is worse
         * than a bare "no": it sends you looking for a mistake you did not make.
         */
        const isProposer = open.proposedByUserId === request.principal?.userId;
        throw forbidden(
          isProposer
            ? "You proposed this change; somebody else has to answer it"
            : "This change is not yours to answer — the parties standing on this date decide it",
        );
      }
      if (await hasAnswered(database, open.id, participant.id)) {
        throw conflict("You have already answered this change");
      }

      const outcome = await answerChangeRequest(request, {
        eventId: id,
        changeRequestId: crid,
        participantId: participant.id,
        response: answer === "confirm" ? "confirmed" : "declined",
        note: request.body.note,
      });

      if (outcome.status !== "pending") {
        await notifyProposer(request, {
          eventId: id,
          proposerProfileId: open.proposedByProfileId,
          outcome: outcome.status,
          changes: open.changes,
          note: request.body.note,
        });
        /*
         * AND TELL THE REST OF THE BILL, when the change actually applied — QA sweep
         * run 6 (QA6-2). The negotiated fields never reach the PATCH's own
         * `eventChangeNotice`, so moving the night used to ring one bell, the
         * proposer's. See `notifyBillChangeApplied` for who is left out and why.
         */
        if (outcome.status === "confirmed") {
          await notifyBillChangeApplied(request, {
            eventId: id,
            proposerProfileId: open.proposedByProfileId,
            changes: open.changes as NegotiatedValues,
          });
        }
      }

      return { status: outcome.status };
    },
  );

  /**
   * IS THIS NIGHT ALREADY TAKEN? — asked BEFORE a booking is made, not after.
   *
   * ClickUp 86cbceux0: *"The system is not warning about double booking a date"*
   * and *"not warning about trying to book on a date marked Unavailable"*. The
   * rule for the first has existed and been tested since the calendar was built
   * (`@showme/shared` `occupiedDates`), and was called only by screens that
   * DISPLAY availability. Nothing asked it at the moment somebody was about to
   * create a clash.
   *
   * ── It warns. It never blocks. ───────────────────────────────────────────
   * This is a read, and creating the event is a separate call that does not
   * consult it. Ran was explicit that a promoter may run several shows on one
   * night, and that the operator can open a date deliberately — so the product
   * rule is "tell them, then let them decide". A route that refused would be a
   * different and worse feature, and no amount of UI could work around it.
   *
   * ── Per ROOM, not per venue ──────────────────────────────────────────────
   * A venue with a main hall and a basement sells two shows on the same Friday.
   * `occupiedDates` carries that (including the rule that a show with NO room
   * recorded occupies every room, because nobody can say which one is still
   * free), so this route decides nothing about availability itself — it gathers
   * the bookings and asks the shared module.
   *
   * ── Only for a venue you are a member of ─────────────────────────────────
   * `requireProfileRole` gates it, which means an operator booking into somebody
   * else's venue gets no warning. That is correct rather than a gap: another
   * operator's calendar is not ours to read, and "the 14th is busy" leaks their
   * bookings to anyone who can guess a profile id.
   */
  app.get(
    "/events/date-conflicts",
    {
      schema: {
        querystring: DateConflictQuery,
        response: { 200: DateConflictResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { venueProfileId, date, stageId, excludeEventId } = request.query;

      requireProfileRole(request, venueProfileId, [...CONFLICT_READ_ROLES]);

      const [rooms, sameDay, blocks] = await Promise.all([
        database
          .select({ id: schema.stages.id, name: schema.stages.name })
          .from(schema.stages)
          .where(eq(schema.stages.venueProfileId, venueProfileId)),
        database
          .select({
            id: schema.events.id,
            title: schema.events.title,
            status: schema.events.status,
            stageId: schema.events.stageId,
          })
          .from(schema.events)
          .where(
            and(
              eq(schema.events.venueProfileId, venueProfileId),
              eq(schema.events.eventDate, date),
              // Everything still standing on the night, INCLUDING the ones that
              // do not take it. `isDateTaken` below decides which of these is a
              // clash and which is only worth mentioning — the room maths needs
              // the whole picture to do that, so the filter here is just
              // "not called off".
              ne(schema.events.status, "cancelled"),
            ),
          ),
        database
          .select()
          .from(schema.profileUnavailability)
          .where(eq(schema.profileUnavailability.profileId, venueProfileId)),
      ]);

      // Editing an event must not warn about the event being edited.
      const others = excludeEventId
        ? sameDay.filter((event) => event.id !== excludeEventId)
        : sameDay;

      const roomIds = rooms.map((room) => room.id);
      const roomNameById = new Map(rooms.map((room) => [room.id, room.name]));
      const busy = occupiedDates(
        { venueProfileId, room: stageId ?? WHOLE_VENUE },
        roomIds,
        others.map((event) => ({
          date,
          venueProfileId,
          stageId: event.stageId,
          // ONLY AN ACCEPTED NIGHT FILLS THE ROOM (Ran, 86cbceux0: *"when it is
          // moved from suggested to pending. I.e. the performer accepts the
          // date"*). A draft or an unanswered offer is somebody thinking, not a
          // booking, and treating it as one is what made this warning fire on
          // empty nights (123qy9rp9rx).
          //
          // The others are still carried to `events` below, so the message can
          // say a draft is there without calling the room busy.
          occupies: isDateTaken(event.status),
        })),
      );

      // A BLOCK ONLY SPEAKS FOR THE ROOM IT NAMES (ClickUp 86cbceux0).
      //
      // `stage_id` null is the whole profile and always applies. A block naming a
      // room applies when that room is the one being asked about — and, when the
      // question is the venue entire, only if it is shut along with every other
      // room. That is the same rule `occupiedDates` uses for bookings, and it has
      // to be: "the Back Room is shut" and "the Back Room is sold" have to answer
      // "can you host me on the 14th" the same way, or the two halves of the
      // warning contradict each other.
      const onThisDate = blocks.filter((block) => block.startDate <= date && date <= block.endDate);
      const wholeVenueBlocks = onThisDate.filter((block) => block.stageId === null);
      const roomBlocks = onThisDate.filter((block) => block.stageId !== null);
      const blockedRoomIds = new Set(roomBlocks.map((block) => block.stageId));
      const blocked = stageId
        ? [...wholeVenueBlocks, ...roomBlocks.filter((block) => block.stageId === stageId)]
        : // No room named: this is the venue-wide question. Room blocks answer it
          // only when they have closed every room there is.
          [
            ...wholeVenueBlocks,
            ...(roomIds.length > 0 && roomIds.every((room) => blockedRoomIds.has(room))
              ? roomBlocks
              : []),
          ];

      return {
        date,
        roomIsBusy: busy.has(date),
        events: others.map((event) => ({
          id: event.id,
          title: event.title,
          status: event.status,
          stageId: event.stageId,
          stageName: event.stageId ? (roomNameById.get(event.stageId) ?? null) : null,
        })),
        unavailability: blocked.map((block) => ({
          startDate: block.startDate,
          endDate: block.endDate,
          reason: block.reason,
        })),
      };
    },
  );
}
