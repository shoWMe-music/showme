import { liveEventDelegationsForEvents } from "@showme/auth";
import { schema } from "@showme/db";
import { eventParticipantRecipients, notifyProfileMembers, notifyUsers } from "@showme/db/notify";
import { formatCalendarDay } from "@showme/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { writeActivity } from "./activity";
import type { Transaction } from "./audit";
import { eventChangeNotice } from "./event-change-notice";

/**
 * CHANGING A NIGHT SOMEBODY HAS ALREADY AGREED TO.
 *
 * ClickUp 86cbcftg3. Ran: *"When trying to change the date for an event the
 * other side must be notified."* — then three different behaviours by status,
 * and a line widening it past the date: *"In general such logic should apply
 * across changes to date, venue, room/space."*
 *
 * ── The one distinction the whole feature turns on ─────────────────────────
 *
 * Below `pending`, nobody has agreed to anything. A `draft` is private and a
 * `suggested` event is an unanswered offer, so the operator moving the date is
 * editing their own proposal — no permission needed, nothing to confirm. What it
 * DOES need is for the question to be asked again, which is Ran's *"Edits the
 * date on the old Incoming request and sends it back into the list as 'Pending'
 * (unread)"*.
 *
 * From `pending` upward, somebody has said yes to a particular night in a
 * particular room. Moving it under them is a NEW QUESTION, and the event has to
 * go on saying what was agreed until it is answered.
 *
 * ── Which fields count ─────────────────────────────────────────────────────
 *
 * The three Ran named: the date, the venue, the room. Everything else about an
 * event — the title, the door time, the notes, the poster — is the operator's to
 * change, and putting a confirm step in front of renaming a show would make the
 * mechanism hated rather than respected.
 */

export const NEGOTIATED_FIELDS = ["eventDate", "venueProfileId", "stageId"] as const;
export type NegotiatedField = (typeof NEGOTIATED_FIELDS)[number];

/** What a proposal can move, and what it moved from. */
export type NegotiatedValues = Partial<Record<NegotiatedField, string | null>>;

/**
 * Statuses at which the night is somebody else's business too.
 *
 * `on_hold` is in: a hold is a date held FOR somebody, and moving it is the same
 * question even though the booking is pencilled. `concluded` and `cancelled` are
 * out because there is nothing left to renegotiate, and an edit to either is
 * record-keeping rather than a booking change.
 */
/**
 * WHO IS A PARTY TO THE BOOKING — the roles with a say in when the show happens.
 *
 * Ran's call, 2026-09-19: "Crew should not be able to move an event." Read as
 * covering BOTH directions, because a vote is a vote either way — a counterpart
 * who declines blocks the move just as surely as a proposer starts it, and
 * leaving crew in the answering set would have let a sound engineer veto a date
 * the venue and the act had both agreed on.
 *
 * It matches the boundary story.md draws for `team_and_crew`: an arm's-length
 * service provider on a fixed fee, who "sees the schedule and their own deal,
 * never the budget". Hired for the night, not a party to it. Contrast `support`,
 * which is an act on the bill, and `agent`, who negotiates for one.
 *
 * Crew are still TOLD. The banner draws for everyone standing on the event —
 * their call time depends on the night — they simply get no buttons, which is
 * the same thing the proposer themselves sees.
 */
/** Every value `event_participants.role` can hold — the enum, as a type. */
export type ParticipantRole = (typeof schema.eventParticipantRole.enumValues)[number];

export const BOOKING_PARTY_ROLES: readonly ParticipantRole[] = [
  "host",
  "co_host",
  "performer",
  "support",
  "agent",
] as const;

const AGREED_STATUSES = new Set(["pending", "confirmed", "on_hold"]);

/** Does a change to this event have to be ASKED rather than simply made? */
export function changeNeedsAgreement(eventStatus: string): boolean {
  return AGREED_STATUSES.has(eventStatus);
}

/**
 * The negotiated fields this patch actually moves — ignoring keys it does not
 * mention, and keys whose value is what the event already says.
 *
 * The second half matters more than it looks: a form that submits every field it
 * rendered will "change" the date to the date it already had on every save, and
 * without this each of those saves would raise a proposal and ask an act to
 * confirm a change to nothing.
 */
export function negotiatedChanges(
  patch: Record<string, unknown>,
  current: NegotiatedValues,
): { changes: NegotiatedValues; previous: NegotiatedValues } {
  const changes: NegotiatedValues = {};
  const previous: NegotiatedValues = {};
  for (const field of NEGOTIATED_FIELDS) {
    if (!(field in patch)) continue;
    const next = (patch[field] ?? null) as string | null;
    const now = current[field] ?? null;
    if (next === now) continue;
    changes[field] = next;
    previous[field] = now;
  }
  return { changes, previous };
}

/** True when the patch moves nothing that has to be negotiated. */
export function isEmptyChange(changes: NegotiatedValues): boolean {
  return Object.keys(changes).length === 0;
}

/**
 * WHERE A PROPOSAL GETS TO once one more answer is in.
 *
 * Unanimous or nothing, and a single refusal settles it — the same shape
 * `confirmDealIfComplete` uses for signatures, and for the same reason: a night
 * two acts are booked on cannot move because one of them was quicker to answer
 * than the other.
 *
 * `required` is the count of participants who must answer, derived at call time
 * rather than stored. A participation removed since the proposal was raised
 * therefore stops holding the change up, without anything having to reap a row.
 */
export function resolveProposal(input: {
  required: number;
  confirmed: number;
  declined: number;
}): "pending" | "confirmed" | "declined" {
  if (input.declined > 0) return "declined";
  // `required === 0` means there is nobody left to ask — every counterpart has
  // gone. Treating that as confirmed is right: the change is being made to an
  // event nobody else is standing on any more, which is the same position the
  // operator is in below `pending`.
  if (input.confirmed >= input.required) return "confirmed";
  return "pending";
}

/** "the date", "the venue and the room" — for a notification a person reads. */
export function describeChange(changes: NegotiatedValues): string {
  const names: Record<NegotiatedField, string> = {
    eventDate: "the date",
    venueProfileId: "the venue",
    stageId: "the room",
  };
  const moved = NEGOTIATED_FIELDS.filter((field) => field in changes).map((field) => names[field]);
  if (moved.length === 0) return "this event";
  if (moved.length === 1) return moved[0] as string;
  const last = moved[moved.length - 1];
  return `${moved.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * HOW MANY PEOPLE WOULD HAVE TO AGREE — nobody, on an event whose only
 * participant is the operator asking.
 *
 * Exported because the DIVERSION is the thing that has to know. A PATCH that
 * moves a booked night strips the negotiated fields out of itself and opens a
 * proposal instead; with an empty counterpart set that proposal is raised with
 * `required: 0`, nobody can answer it, `answerChangeRequest` is the only code that
 * applies a change, and the date is frozen for good — with the pending row then
 * superseding every later attempt. Measured 2026-09-26 on two events, and it is
 * the shape the seed ships: a night is host-only until somebody is invited.
 *
 * `resolveProposal` already says the right thing about zero ("nobody left to ask"
 * ⇒ confirmed). It was simply never consulted at the moment the question was
 * asked, only when somebody answered one.
 */
export async function counterpartCount(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
  proposerUserId: string | null,
): Promise<number> {
  return (await counterparts(database, eventId, proposerUserId)).length;
}

/**
 * The participations that must answer a proposal — everyone standing on the
 * event except the profile proposing it.
 *
 * `STANDING` rather than "not removed": somebody who has not accepted their own
 * invitation has no say in moving a night they have not agreed to, and a
 * declined participation is gone. Same set the authorization module uses, so a
 * change cannot be blocked by a party who cannot even read the event.
 */
async function counterparts(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  tx: any,
  eventId: string,
  proposerUserId: string | null,
): Promise<{ id: string; profileId: string | null }[]> {
  const rows = await tx
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
    })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.status, ["accepted", "confirmed"]),
        // Crew are not asked — see `BOOKING_PARTY_ROLES`.
        inArray(schema.eventParticipants.role, [...BOOKING_PARTY_ROLES]),
      ),
    );

  // A DELEGATED PERFORMER DOES NOT ANSWER — THEIR AGENT DOES (decisions #14).
  //
  // Adding a represented act to an event auto-assigns their agent as a
  // participant, so the naive set counts both and demands two answers for one
  // party's interest — from a performer who has handed the action capabilities
  // (confirm / approve) to that very agent. Driving it live is what showed this:
  // the seeded booking asked for two confirmations where there is one decision.
  //
  // `liveEventDelegationsForEvents` is the same resolver `authorize` uses, so a
  // delegation that has lapsed stops standing in immediately rather than waiting
  // for the sweep — and the performer gets their own say back the moment it does.
  const delegations = await liveEventDelegationsForEvents(tx, [eventId]);
  const delegatedParticipantIds = new Set(
    (delegations.get(eventId) ?? []).map((delegation) => delegation.performerParticipantId),
  );
  const standing = (rows as { id: string; profileId: string | null }[]).filter(
    (row) => !delegatedParticipantIds.has(row.id),
  );

  if (!proposerUserId) return standing;

  // EXCLUDE BY USER, not by acting profile.
  //
  // The obvious version of this asked `profile_id <> actingProfileId`, and it is
  // wrong in two ways that both let an operator wave their own proposal through:
  // `X-Profile-Id` is optional, so `actingProfileId` is frequently null and then
  // nothing is excluded at all; and an operator holding two profiles on one event
  // (host with one, co-host with another) would still be a counterpart through
  // the second. The honest question is "does this participation belong to the
  // person who asked", which is a membership lookup.
  const mine = await tx
    .select({ profileId: schema.profileMembers.profileId })
    .from(schema.profileMembers)
    .where(
      and(
        eq(schema.profileMembers.userId, proposerUserId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  const ownProfileIds = new Set(mine.map((row: { profileId: string }) => row.profileId));
  return standing.filter((row) => !row.profileId || !ownProfileIds.has(row.profileId));
}

/**
 * PUT THE NEGOTIATION IN THE CONVERSATION (ClickUp 86cbcftg3).
 *
 * Ran: *"such things and UI should also be in the messages box as well in my
 * opinion."*
 *
 * A proposal, and its answer, are written into the event room thread as ordinary
 * messages. That is not a second copy of the proposal — the live state stays in
 * `event_change_requests`, and the banner reads it from there. This is the
 * HISTORY: "we moved this once, and they agreed" is exactly the kind of fact a
 * thread exists to keep, and without it a conversation reads "can we move it?" /
 * "sure" with no record of what was actually agreed.
 *
 * ── Attributed to the person who did it, because they did ──────────────────
 * `event_messages.sender_user_id` is NOT NULL and there is no system user, which
 * turns out to be the right constraint rather than an obstacle: an operator DID
 * ask, and a performer DID answer. The wording is a record rather than speech —
 * "Asked to change the date…", not "I'd like to move this" — so it never puts
 * words in somebody's mouth.
 *
 * ── `all`, not `party` ─────────────────────────────────────────────────────
 * The event room, where everyone on the bill reads it. A night moving is not a
 * private matter between two of them: the crew's call time depends on it. Same
 * reasoning as the banner, which also draws for people who cannot answer it.
 *
 * ── ISO dates on purpose ───────────────────────────────────────────────────
 * This is stored text, read later by people in several countries, and it is not
 * re-rendered by the client the way a `DateText` is. `2026-10-15` carries its
 * year and cannot be read month-first by mistake (ClickUp 86cbaxud0), which a
 * prettier format written into a permanent row could.
 */
async function postChangeMessage(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  tx: any,
  request: FastifyRequest,
  input: { eventId: string; body: string },
): Promise<void> {
  const principal = request.principal;
  if (!principal) return;

  // Their own participation, so the thread shows who spoke. Null is survivable —
  // the message still posts, attributed to the user.
  const [participant] = await tx
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, input.eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );

  await tx.insert(schema.eventMessages).values({
    eventId: input.eventId,
    senderUserId: principal.userId,
    senderParticipantId: participant?.id ?? null,
    body: input.body,
    visibility: "all",
  });
}

/** "the date from 2026-09-24 to 2026-10-15" — the sentence the message is built on. */
export function describeMove(changes: NegotiatedValues, previous: NegotiatedValues): string {
  const parts: string[] = [];
  if ("eventDate" in changes) {
    parts.push(
      `the date from ${formatCalendarDay(previous.eventDate) || "no date"} to ${
        formatCalendarDay(changes.eventDate) || "no date"
      }`,
    );
  }
  if ("venueProfileId" in changes) parts.push("the venue");
  if ("stageId" in changes) parts.push("the room");
  if (parts.length === 0) return "this event";
  if (parts.length === 1) return parts[0] as string;
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * Raise a proposal and tell the people who have to answer it.
 *
 * ── An open proposal is REPLACED, not stacked ─────────────────────────────
 * An operator who moves the date twice before anyone answers has changed their
 * mind, not asked two questions. The earlier request becomes `superseded` so the
 * act is never looking at two live proposals for the same night with no way to
 * know which one matters.
 */
export async function proposeEventChange(
  request: FastifyRequest,
  input: {
    eventId: string;
    changes: NegotiatedValues;
    previous: NegotiatedValues;
    /** Why the proposer is asking. Optional, and theirs to word. */
    reason?: string;
  },
): Promise<void> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const proposerProfileId = principal.actingProfileId ?? null;

  const [event] = await database
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId));

  const parties = await counterparts(database, input.eventId, principal.userId);

  const created = await database.transaction(async (tx) => {
    await tx
      .update(schema.eventChangeRequests)
      .set({ status: "superseded", resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.eventChangeRequests.eventId, input.eventId),
          eq(schema.eventChangeRequests.status, "pending"),
        ),
      );

    const [row] = await tx
      .insert(schema.eventChangeRequests)
      .values({
        eventId: input.eventId,
        proposedByProfileId: proposerProfileId,
        proposedByUserId: principal.userId,
        changes: input.changes,
        previous: input.previous,
        reason: input.reason ?? null,
      })
      .returning();
    if (!row) throw new Error("change request create failed");

    await writeActivity(tx, request, {
      eventId: input.eventId,
      type: "event.change_requested",
      targetKind: "event",
      targetId: input.eventId,
      summary: { changes: input.changes, previous: input.previous },
    });
    // …and into the conversation, so the thread carries the negotiation and not
    // just its outcome (86cbcftg3).
    await postChangeMessage(tx, request, {
      eventId: input.eventId,
      body: `Asked to change ${describeMove(input.changes, input.previous)}. Waiting on the other side to confirm.`,
    });
    return row;
  });

  const what = describeChange(input.changes);
  for (const party of parties) {
    if (!party.profileId) continue;
    try {
      await notifyProfileMembers(database, party.profileId, principal.userId, {
        type: "event.change_requested",
        title: `A change to ${event?.title ?? "an event"}`,
        body: `Somebody has asked to change ${what}. Confirm or decline it on the event.${input.reason ? ` Reason: ${input.reason}` : ""}`,
        eventId: input.eventId,
        link: `/events/${input.eventId}`,
        metadata: { changeRequestId: created.id, changes: input.changes },
      });
    } catch (cause) {
      request.log.warn({ err: cause, eventId: input.eventId }, "change-request notify failed");
    }
  }
}

/**
 * Below `pending`: the change already happened, so re-ask the offer.
 *
 * Ran, on a `suggested` event: *"Edits the date on the old Incoming request and
 * sends it back into the list as 'Pending' (unread)"* — and, on a refusal, that
 * the operator *"can ... edit it to change the date → which will trigger a new
 * incoming request with a new date"*.
 *
 * So a `declined` participation goes back to `invited`. That is deliberately not
 * "pestering somebody who said no": they said no to a different night. The
 * invitation they now hold names the new one.
 */
export async function reopenInvitationsAfterChange(
  request: FastifyRequest,
  input: { eventId: string; changes: NegotiatedValues },
): Promise<void> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const reopened = await database
    .update(schema.eventParticipants)
    .set({ status: "invited", updatedAt: new Date() })
    .where(
      and(
        eq(schema.eventParticipants.eventId, input.eventId),
        eq(schema.eventParticipants.status, "declined"),
      ),
    )
    .returning({ id: schema.eventParticipants.id, profileId: schema.eventParticipants.profileId });

  const [event] = await database
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId));

  // Everyone holding an unanswered invitation is told the question moved —
  // including the ones just reopened, which is the whole point of the reopening.
  const invited = await database
    .select({ profileId: schema.eventParticipants.profileId })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, input.eventId),
        eq(schema.eventParticipants.status, "invited"),
      ),
    );

  const what = describeChange(input.changes);
  for (const party of invited) {
    if (!party.profileId) continue;
    try {
      await notifyProfileMembers(database, party.profileId, principal.userId, {
        type: "event.invitation_updated",
        title: `${event?.title ?? "An invitation"} — ${what} changed`,
        body: "The invitation you have not answered yet now names a different night.",
        eventId: input.eventId,
        link: "/requests",
        metadata: { changes: input.changes, reopened: reopened.length },
      });
    } catch (cause) {
      request.log.warn({ err: cause, eventId: input.eventId }, "invitation-update notify failed");
    }
  }
}

/** The open proposal on an event, with the answers so far. Null when there is none. */
export async function openChangeRequest(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
): Promise<{
  id: string;
  changes: NegotiatedValues;
  previous: NegotiatedValues;
  reason: string | null;
  proposedByProfileId: string | null;
  proposedByUserId: string | null;
  /** Participations that must answer — the route gates the caller on this. */
  partyIds: string[];
  createdAt: Date;
  required: number;
  confirmed: number;
  declined: number;
} | null> {
  const [row] = await database
    .select()
    .from(schema.eventChangeRequests)
    .where(
      and(
        eq(schema.eventChangeRequests.eventId, eventId),
        eq(schema.eventChangeRequests.status, "pending"),
      ),
    );
  if (!row) return null;

  const parties = await counterparts(database, eventId, row.proposedByUserId);
  const answers = await database
    .select({
      participantId: schema.eventChangeRequestResponses.participantId,
      response: schema.eventChangeRequestResponses.response,
    })
    .from(schema.eventChangeRequestResponses)
    .where(eq(schema.eventChangeRequestResponses.changeRequestId, row.id));

  // Only answers from people who ARE still counterparts count — see the note on
  // the responses table about why the required set is derived rather than stored.
  const partyIds = new Set(parties.map((party) => party.id));
  const live = answers.filter((answer: { participantId: string }) =>
    partyIds.has(answer.participantId),
  );

  return {
    id: row.id,
    changes: row.changes as NegotiatedValues,
    previous: row.previous as NegotiatedValues,
    reason: row.reason,
    proposedByProfileId: row.proposedByProfileId,
    proposedByUserId: row.proposedByUserId,
    partyIds: parties.map((party) => party.id),
    createdAt: row.createdAt,
    required: parties.length,
    confirmed: live.filter((one: { response: string }) => one.response === "confirmed").length,
    declined: live.filter((one: { response: string }) => one.response === "declined").length,
  };
}

/**
 * One counterpart answers — and, if that was the last answer needed, the change
 * is APPLIED here.
 *
 * Applying it here rather than leaving the operator to re-save is the whole
 * point of the mechanism: the act agreed to a specific new night, and a flow
 * that then required the operator to type it again would leave a window in which
 * everyone has agreed and the event still says the old date.
 */
export async function answerChangeRequest(
  request: FastifyRequest,
  input: {
    eventId: string;
    changeRequestId: string;
    participantId: string;
    response: "confirmed" | "declined";
    note?: string;
  },
): Promise<{ status: "pending" | "confirmed" | "declined" }> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx handle, as elsewhere here.
  return await database.transaction(async (tx: any) => {
    const [row] = await tx
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.id, input.changeRequestId));
    if (!row || row.eventId !== input.eventId || row.status !== "pending") {
      throw new Error("no open change request");
    }

    await tx.insert(schema.eventChangeRequestResponses).values({
      changeRequestId: input.changeRequestId,
      participantId: input.participantId,
      response: input.response,
      note: input.note ?? null,
      respondedByUserId: principal.userId,
    });

    const parties = await counterparts(tx, input.eventId, row.proposedByUserId);
    const partyIds = new Set(parties.map((party) => party.id));
    const answers = await tx
      .select({
        participantId: schema.eventChangeRequestResponses.participantId,
        response: schema.eventChangeRequestResponses.response,
      })
      .from(schema.eventChangeRequestResponses)
      .where(eq(schema.eventChangeRequestResponses.changeRequestId, input.changeRequestId));
    const live = answers.filter((answer: { participantId: string }) =>
      partyIds.has(answer.participantId),
    );

    const outcome = resolveProposal({
      required: parties.length,
      confirmed: live.filter((one: { response: string }) => one.response === "confirmed").length,
      declined: live.filter((one: { response: string }) => one.response === "declined").length,
    });

    if (outcome === "pending") return { status: outcome };

    await tx
      .update(schema.eventChangeRequests)
      .set({ status: outcome, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.eventChangeRequests.id, input.changeRequestId));

    if (outcome === "confirmed") {
      const changes = row.changes as NegotiatedValues;
      await tx
        .update(schema.events)
        .set({
          ...changes,
          version: sql`${schema.events.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.events.id, input.eventId));
    }

    await writeActivity(tx, request, {
      eventId: input.eventId,
      type: outcome === "confirmed" ? "event.change_confirmed" : "event.change_declined",
      targetKind: "event",
      targetId: input.eventId,
      summary: {
        changes: row.changes,
        previous: row.previous,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    const moved = describeMove(row.changes as NegotiatedValues, row.previous as NegotiatedValues);
    await postChangeMessage(tx, request, {
      eventId: input.eventId,
      body:
        outcome === "confirmed"
          ? `Confirmed the change to ${moved}. The event has been updated.`
          : `Declined the change to ${moved}.${input.note ? ` Reason: ${input.note}` : ""}`,
    });

    return { status: outcome };
  });
}

/**
 * TELL THE BILL THE NIGHT ACTUALLY MOVED — QA sweep run 6 (QA6-2).
 *
 * The asymmetry the sweep measured: changing a show's **capacity** wrote five
 * `event.updated` notifications, and moving its **date** wrote one — to the person
 * who had asked for the move and therefore already knew. Nobody else's bell rang.
 *
 * The cause is structural rather than an oversight about who matters. The
 * negotiated fields are stripped out of the ordinary PATCH and applied here
 * instead, so they never reach the `eventChangeNotice` call in `routes/events.ts`
 * that tells everyone about an edit; the only notifier on this path was
 * `notifyProposer`. Ran's line on `86cbcftg3` is *"the system should always notify
 * the users of any change"*, and the file above says the crew *"are still TOLD …
 * their call time depends on the night"* — which was true of the Everyone thread
 * and false of the bell.
 *
 * So this is the same notice the ordinary edit sends, on the path that applies a
 * negotiated one, with the same wording rules: field NAMES and not values.
 *
 * TWO PEOPLE ARE LEFT OUT, both because they already have a better message:
 *  - the ACTOR, the party who just confirmed — `eventParticipantRecipients` drops
 *    them, exactly as the ordinary edit drops whoever saved;
 *  - the PROPOSER, who gets `event.change_confirmed` from `notifyProposer` — "the
 *    date moved, everyone agreed". A second bell reading "the date changed"
 *    underneath it is noise on top of the message that mattered, which is the
 *    reasoning `event-change-notice.ts` already applies to a cancellation.
 *
 * Only on `confirmed`. A declined proposal changed nothing, so there is nothing to
 * announce to a bill that never saw it; the proposer's own notice carries the no.
 */
export async function notifyBillChangeApplied(
  request: FastifyRequest,
  input: {
    eventId: string;
    proposerProfileId: string | null;
    changes: NegotiatedValues;
  },
): Promise<void> {
  const { database } = request.server;
  const actorUserId = request.principal?.userId ?? null;

  const [event] = await database
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId));
  if (!event) return;

  // The same allow-list and the same sentence the ordinary edit uses. A negotiated
  // change never carries the title (`NEGOTIATED_FIELDS` is the date, the venue and
  // the room), so both titles are the current one and it reads "was updated".
  const notice = eventChangeNotice(Object.keys(input.changes), {
    title: event.title,
    previousTitle: event.title,
  });
  if (!notice) return;

  try {
    const recipients = await eventParticipantRecipients(database, input.eventId, actorUserId);
    const proposerMembers = input.proposerProfileId
      ? await database
          .select({ userId: schema.profileMembers.userId })
          .from(schema.profileMembers)
          .where(
            and(
              eq(schema.profileMembers.profileId, input.proposerProfileId),
              eq(schema.profileMembers.status, "active"),
            ),
          )
      : [];
    const alreadyTold = new Set(
      proposerMembers
        .map((row) => row.userId)
        .filter((userId): userId is string => userId !== null),
    );
    const told = recipients.filter((userId) => !alreadyTold.has(userId));
    if (told.length === 0) return;

    await notifyUsers(database, told, actorUserId, {
      type: "event.updated",
      title: notice.title,
      body: notice.body,
      eventId: input.eventId,
      // WHO, the other half of Ran's sentence — here it is whoever gave the last
      // answer, because that answer is what applied the change.
      actorDisplay: request.firebaseUser?.name ?? undefined,
      link: `/events/${input.eventId}`,
      metadata: { fields: notice.fields },
    });
  } catch (cause) {
    request.log.error(
      { err: cause, eventId: input.eventId },
      "applied-change bill notification failed",
    );
  }
}

/** Tell the proposer what came back. Outside the transaction, as everywhere else. */
export async function notifyProposer(
  request: FastifyRequest,
  input: {
    eventId: string;
    proposerProfileId: string | null;
    outcome: "confirmed" | "declined";
    changes: NegotiatedValues;
    note?: string;
  },
): Promise<void> {
  if (!input.proposerProfileId) return;
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) return;

  const [event] = await database
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId));

  const what = describeChange(input.changes);
  // `describeChange` is written for the middle of a sentence ("asked to change
  // the date"), so it starts lowercase. A title starts a sentence.
  const Sentence = what.charAt(0).toUpperCase() + what.slice(1);
  try {
    await notifyProfileMembers(database, input.proposerProfileId, principal.userId, {
      type: `event.change_${input.outcome}`,
      title:
        input.outcome === "confirmed"
          ? `${Sentence} moved — ${event?.title ?? "your event"}`
          : `${Sentence} stays — ${event?.title ?? "your event"}`,
      body:
        input.outcome === "confirmed"
          ? "Everyone agreed, and the event has been updated."
          : input.note || "The change was declined.",
      eventId: input.eventId,
      link: `/events/${input.eventId}`,
      metadata: { changes: input.changes, ...(input.note ? { note: input.note } : {}) },
    });
  } catch (cause) {
    request.log.warn({ err: cause, eventId: input.eventId }, "change-outcome notify failed");
  }
}

/**
 * The caller's own participation on this event, or null.
 *
 * Deliberately NOT scoped to standing statuses: an `invited` participant is not
 * a counterpart and the routes refuse them anyway, but they refuse them with a
 * message about who may answer rather than with "you are not on this event",
 * which would be a lie.
 */
export async function callerParticipantOrNull(
  request: FastifyRequest,
  eventId: string,
  /**
   * Narrow to particular event-roles. Defaulted to every role because most
   * callers mean "is this person on the event at all"; the propose route passes
   * `BOOKING_PARTY_ROLES` because it is asking a different question — "does this
   * person get a say in the date" — and the two must not be conflated.
   */
  roles: readonly ParticipantRole[] = schema.eventParticipantRole.enumValues,
): Promise<{ id: string; profileId: string | null } | null> {
  const principal = request.principal;
  if (!principal) return null;
  const rows = await request.server.database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      status: schema.eventParticipants.status,
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
        inArray(schema.eventParticipants.status, ["accepted", "confirmed"]),
        inArray(schema.eventParticipants.role, [...roles]),
      ),
    );
  // Prefer the profile the caller is acting as — somebody holding two profiles on
  // one event answers as the one the sidebar says they are.
  const acting = rows.find((row) => row.profileId === principal.actingProfileId);
  const chosen = acting ?? rows[0];
  return chosen ? { id: chosen.id, profileId: chosen.profileId } : null;
}

/** Has this participant already answered this proposal? */
export async function hasAnswered(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  changeRequestId: string,
  participantId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: schema.eventChangeRequestResponses.id })
    .from(schema.eventChangeRequestResponses)
    .where(
      and(
        eq(schema.eventChangeRequestResponses.changeRequestId, changeRequestId),
        eq(schema.eventChangeRequestResponses.participantId, participantId),
      ),
    );
  return Boolean(row);
}

/**
 * CANCELLING A SHOW CLOSES THE QUESTIONS STILL OPEN ON IT — QA sweep run 5 (QA5-2) and
 * run 4 (QA4-16), which are the same finding at two surfaces: *"cancelling closes nothing
 * that is still open on the event."*
 *
 * A pending change request asks the bill to agree a new date for a night that is now off.
 * Answering it either way is meaningless, and leaving it live means the Confirm/Decline
 * banner sits on top of a cancelled event asking three people to agree its date.
 *
 * `superseded`, not `declined`: nobody refused anything. It is the same state a second
 * proposal puts the first one in (`proposeEventChange` above) — "this question was
 * overtaken by events" — and it keeps the row for the timeline rather than deleting it.
 *
 * Returns how many it closed, so the caller can log or test it. Takes a transaction: this
 * belongs in the same write as the cancellation, because a show that is off with a live
 * proposal on it is the state this exists to prevent.
 */
export async function closeChangeRequestsOnCancel(
  tx: Transaction,
  eventId: string,
): Promise<number> {
  const closed = await tx
    .update(schema.eventChangeRequests)
    .set({ status: "superseded", resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.eventChangeRequests.eventId, eventId),
        eq(schema.eventChangeRequests.status, "pending"),
      ),
    )
    .returning({ id: schema.eventChangeRequests.id });
  return closed.length;
}
