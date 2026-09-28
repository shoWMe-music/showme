import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { type Database, schema } from "@showme/db";
import { notifyProfileMembers } from "@showme/db/notify";
import { CLOSED_EVENT_STATUSES } from "@showme/db/representation-termination";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Transaction } from "./audit";
import { assertRepresentationPartyKinds, isRepresentationActiveAt } from "./representation-rules";

type RepresentationRow = typeof schema.representations.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

/**
 * An event that is over (or never happened) is out of the agent's reach. Shared
 * with the termination path (`@showme/db/representation-termination`) so "still
 * open" means one thing on the way in and on the way out.
 */
const CLOSED_STATUSES = CLOSED_EVENT_STATUSES;

/** Find or create the agent profile's `agent`-preset permission set (reused across events). */
async function agentPermissionSetId(tx: Transaction, agentProfileId: string): Promise<string> {
  const [existing] = await tx
    .select()
    .from(schema.permissionSets)
    .where(
      and(
        eq(schema.permissionSets.profileId, agentProfileId),
        eq(schema.permissionSets.name, "agent"),
      ),
    );
  if (existing) return existing.id;
  const [created] = await tx
    .insert(schema.permissionSets)
    .values({
      profileId: agentProfileId,
      name: "agent",
      capabilities: [...PRESET_PERMISSION_SETS.agent],
    })
    .returning();
  if (!created) throw new Error("agent permission set create failed");
  return created.id;
}

/**
 * Is a country inside the representation's territory (∈ `region`, or worldwide)?
 * The territory test with the database read lifted out, so a read path that already
 * knows the venue's country (deal authority resolution) applies the same rule.
 */
export function countryInRegion(
  country: string | null | undefined,
  representation: RepresentationRow,
): boolean {
  if (representation.isWorldwide) return true;
  const region = representation.region ?? [];
  if (region.length === 0 || country == null) return false;
  return region.includes(country);
}

/** Is a venue within the representation's territory (venue country ∈ region, or worldwide)? */
async function venueInRegion(
  tx: Transaction,
  venueProfileId: string | null,
  representation: RepresentationRow,
): Promise<boolean> {
  if (representation.isWorldwide) return true;
  if (!venueProfileId) return false;
  const [location] = await tx
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(eq(schema.profileLocations.profileId, venueProfileId));
  return countryInRegion(location?.country, representation);
}

/**
 * Are the two profiles on this representation still the kinds a representation is
 * defined between (`agent` → `performer`)? Kinds are fixed at signup, so this can
 * only ever fail for a row that bypassed the route — which is exactly why the
 * write path re-checks instead of trusting the row.
 */
async function representationPartiesAreCorrectKinds(
  tx: Transaction,
  representation: RepresentationRow,
): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.profiles.id, kind: schema.profiles.kind })
    .from(schema.profiles)
    .where(
      inArray(schema.profiles.id, [
        representation.agentProfileId,
        representation.performerProfileId,
      ]),
    );
  const kindOf = (profileId: string) => rows.find((row) => row.id === profileId)?.kind;
  try {
    assertRepresentationPartyKinds(
      kindOf(representation.agentProfileId),
      kindOf(representation.performerProfileId),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Assign the agent to ONE event (decisions #14 fan-out, like adding a group #12):
 * materialize the agent as a negotiate/approve participant and flag the performer's
 * participation delegated (→ view-only, enforced by the auth engine). Applies only
 * to the performer's own, in-region, not-yet-closed events. Idempotent. Returns
 * whether it applied.
 */
export async function assignAgentToEvent(
  tx: Transaction,
  representation: RepresentationRow,
  eventId: string,
): Promise<boolean> {
  const [event] = await tx.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || (CLOSED_STATUSES as readonly string[]).includes(event.status)) return false;

  // Belt-and-braces on the kind rule (audit A-16). The route refuses to create or
  // activate a representation between the wrong kinds, but this is the function
  // that WRITES the delegation flag, and a delegation flag on a crew or operator
  // participant is a silent authority grant no screen would explain. A row that
  // somehow escaped the route (a seed, a migration, a future caller) stops here
  // rather than projecting itself onto an event.
  if (!(await representationPartiesAreCorrectKinds(tx, representation))) return false;

  // You can only delegate what you hold — the performer must be on the event.
  const [performerParticipant] = await tx
    .select()
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.profileId, representation.performerProfileId),
      ),
    );
  if (!performerParticipant) return false;
  if (!(await venueInRegion(tx, event.venueProfileId, representation))) return false;

  // Materialize the agent participant. A row may already exist and be `removed`
  // — a previous representation that was terminated (unassignment soft-removes,
  // it never deletes) — in which case re-signing the agent REINSTATES that row
  // rather than skipping it, which would otherwise leave the agent on the event
  // with no access at all.
  const [existingAgent] = await tx
    .select()
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.profileId, representation.agentProfileId),
      ),
    );
  // THE AGENT'S STANDING MIRRORS THEIR ACT'S (ClickUp 86cbcehmp).
  //
  // This used to insert the agent as `accepted` outright, which put them on an
  // event nobody had agreed to play: the act sat at `invited` while their agent
  // already had the run of the booking. An agent participation is the PROJECTION
  // of a representation, not a booking of its own — so it can never be further
  // along than the act it projects.
  //
  // Practically this means an unanswered invitation leaves the agent `invited`
  // too, and answering it moves both (see `answerInvitation`). Nothing here has
  // to know about the answer; it only has to stop claiming one was given.
  const mirroredStatus = performerParticipant.status === "invited" ? "invited" : "accepted";
  if (!existingAgent) {
    const permissionSetId = await agentPermissionSetId(tx, representation.agentProfileId);
    await tx.insert(schema.eventParticipants).values({
      eventId,
      profileId: representation.agentProfileId,
      role: "agent",
      permissionSetId,
      status: mirroredStatus,
    });
  } else if (existingAgent.status === "removed") {
    const permissionSetId = await agentPermissionSetId(tx, representation.agentProfileId);
    await tx
      .update(schema.eventParticipants)
      .set({ role: "agent", permissionSetId, status: mirroredStatus, updatedAt: new Date() })
      .where(eq(schema.eventParticipants.id, existingAgent.id));
  }

  // Flag the performer's participation delegated → view-only (auth engine reads this).
  const details = (performerParticipant.details as Record<string, unknown> | null) ?? {};
  await tx
    .update(schema.eventParticipants)
    .set({
      details: { ...details, delegatedToAgentProfileId: representation.agentProfileId },
      updatedAt: new Date(),
    })
    .where(eq(schema.eventParticipants.id, performerParticipant.id));

  return true;
}

/** Assign to a performer-chosen set of current events; returns how many applied. */
export async function assignAgentToEvents(
  tx: Transaction,
  representation: RepresentationRow,
  eventIds: string[],
): Promise<number> {
  let applied = 0;
  for (const eventId of eventIds) {
    if (await assignAgentToEvent(tx, representation, eventId)) {
      applied += 1;
    }
  }
  return applied;
}

/**
 * ONE AGENT PUT ON ONE EVENT, reported back so somebody can be told.
 *
 * The assignment is a write inside a transaction; telling the agent is a delivery
 * that cannot be taken back. So this function reports rather than notifies, and the
 * caller tells them after the commit — the rule every notification in this app
 * follows. See {@link notifyAgentsOfAssignment}.
 */
export interface AgentAssignment {
  agentProfileId: string;
  /** WHOSE agent they are on this event — the only fact that makes the news useful. */
  performerProfileId: string;
}

/**
 * Auto-assignment for FUTURE events (decisions #14): when a performer joins an
 * in-region event, any of their ACTIVE representations covering that territory
 * takes control automatically — no per-event opt-in for future events.
 *
 * Returns what it actually attached (empty for an unrepresented act, an out-of-region
 * venue, or an agent already standing on the event), because decisions #14 also
 * requires the agent to be TOLD and that cannot happen in here — see
 * `AgentAssignment` above.
 */
export async function autoAssignAgentOnPerformerJoin(
  tx: Transaction,
  event: EventRow,
  performerProfileId: string,
): Promise<AgentAssignment[]> {
  const now = new Date();
  // `status = 'active'` is only the SQL prefilter — a row can carry an agreed
  // future termination and still be `active`, and one whose moment has passed is
  // dead before the sweep runs. `isRepresentationActiveAt` is the answer (A-19).
  const activeReps = (
    await tx
      .select()
      .from(schema.representations)
      .where(
        and(
          eq(schema.representations.performerProfileId, performerProfileId),
          eq(schema.representations.status, "active"),
        ),
      )
  ).filter((representation) => isRepresentationActiveAt(representation, now));
  const assigned: AgentAssignment[] = [];
  for (const representation of activeReps) {
    if (await venueInRegion(tx, event.venueProfileId, representation)) {
      // The boolean is whether a row was actually written — `assignAgentToEvent`
      // refuses a closed event, the wrong party kinds, a performer who is not on the
      // bill, and an agent who is already standing here. Only a real attachment is
      // news, so only a real attachment is reported.
      if (await assignAgentToEvent(tx, representation, event.id)) {
        assigned.push({
          agentProfileId: representation.agentProfileId,
          performerProfileId: representation.performerProfileId,
        });
      }
    }
  }
  return assigned;
}

/**
 * DOES THIS AGENT REPRESENT ANYBODY WHO IS ACTUALLY ON THIS EVENT? (QA sweep run 7, QA7-7)
 *
 * `assignAgentToEvent` above already refuses an agent whose act is not on the bill —
 * *"you can only delegate what you hold"* — and that is the whole rule. But it is the
 * rule of the AUTO-ASSIGN path only, and `POST /events/:id/participants {role: "agent"}`
 * never goes near it. So an operator could add an agent directly to an event none of
 * their artists is on and get **201** with `status: "invited"`, plus a notification
 * promising access, over a participation the agent then gets **404** from at every turn:
 * the event, the accept, the deals. Nothing leaked — `authorize` holds the line — but
 * what was left behind is a permanent `invited` row nobody can act on and a
 * notification that lies. The refusal belonged at the write.
 *
 * This is the shape `notifyAgentsOfAssignment` records three inches below: *a rule that
 * lives at one caller is a rule the other callers skip in silence.* Same module, same
 * question, one row wider — `assignAgentToEvent` asks it of ONE representation, this asks
 * whether ANY of them lands here.
 *
 * `story.md` is the authority for refusing rather than allowing: an agent *"acts through
 * the performers they represent"*, so where there is nobody to act through there is no
 * participation to create. The correct path already demonstrates the alternative — add
 * the ACT and the agent follows automatically, named in the notification.
 */
export async function agentRepresentsSomeoneOnEvent(
  database: Database | Transaction,
  eventId: string,
  agentProfileId: string,
): Promise<boolean> {
  const now = new Date();
  const representations = await database
    // Exactly the two columns `isRepresentationActiveAt` reads, and no more: a row's
    // `status` alone is not the truth, and nothing else here is.
    .select({
      status: schema.representations.status,
      terminatedEffectiveAt: schema.representations.terminatedEffectiveAt,
    })
    .from(schema.representations)
    .innerJoin(
      schema.eventParticipants,
      and(
        eq(schema.eventParticipants.profileId, schema.representations.performerProfileId),
        eq(schema.eventParticipants.eventId, eventId),
      ),
    )
    .where(
      and(
        eq(schema.representations.agentProfileId, agentProfileId),
        eq(schema.representations.status, "active"),
        // A removed participation is not standing on the bill, so it delegates nothing.
        notInArray(schema.eventParticipants.status, ["removed"]),
      ),
    );
  // `status = 'active'` is the SQL prefilter only: a row can carry an agreed future
  // termination and still read active, and one whose moment has passed is dead before the
  // sweep runs (A-19). Same reason, same answer as `autoAssignAgentOnPerformerJoin`.
  return representations.some((representation) => isRepresentationActiveAt(representation, now));
}

/**
 * TELL THE AGENT THEIR ACT PUT THEM ON A SHOW — QA sweep run 4, QA4-7.
 *
 * decisions #14 says an agent must be told when their act is invited, and until now
 * that half of the rule had no mechanism at all: the wizard path attached the agent
 * to the event in the same transaction as the performer and notified only the
 * performer. Somebody was given authority over a night and nobody said so.
 *
 * ONE implementation, called by every path that can attach an agent
 * (`routes/events.ts`, `routes/invitations.ts`, `routes/participants.ts`,
 * `routes/inbound.ts`), for the reason this loop has now met three times in one day:
 * a rule that lives at one caller is a rule the other callers skip in silence.
 *
 * The message names the PERFORMER, not the role. An agency with thirty acts on its
 * roster gets these all week, and "you were added to an event" is the one sentence
 * that does not say which of their artists it is about. `story.md`: an agent exists
 * to act for a named performer.
 *
 * Best-effort by contract, like every notification here — the participant rows are
 * already committed, and a delivery failure must not suggest otherwise.
 */
export async function notifyAgentsOfAssignment(
  database: Database,
  request: FastifyRequest,
  event: { id: string; title: string },
  assignments: readonly AgentAssignment[],
): Promise<void> {
  if (assignments.length === 0) return;
  for (const assignment of assignments) {
    try {
      const [performer] = await database
        .select({ name: schema.profiles.name })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, assignment.performerProfileId));
      const act = performer?.name ?? "an act you represent";
      await notifyProfileMembers(
        database,
        assignment.agentProfileId,
        request.principal?.userId ?? null,
        {
          type: "event.participant_added",
          title: `${act} is on "${event.title}"`,
          body: `You were added to the show as ${act}'s agent, so their deal and their settlement are yours to handle.`,
          eventId: event.id,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${event.id}`,
          metadata: { eventId: event.id, performerProfileId: assignment.performerProfileId },
        },
      );
    } catch (error) {
      request.log.error(
        { error, eventId: event.id, agentProfileId: assignment.agentProfileId },
        "agent-assignment notification failed",
      );
    }
  }
}

/** One candidate event for the delegation picker screen. */
export interface DelegatableEvent {
  eventId: string;
  title: string;
  alreadyAssigned: boolean;
}

/**
 * The performer's current (non-concluded) in-region events — the list the app
 * shows so the performer can pick which existing events to hand over (or "all").
 */
export async function delegatableEvents(
  tx: Transaction,
  representation: RepresentationRow,
): Promise<DelegatableEvent[]> {
  const rows = await tx
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      venueProfileId: schema.events.venueProfileId,
      performerDetails: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
    .where(
      and(
        eq(schema.eventParticipants.profileId, representation.performerProfileId),
        notInArray(schema.events.status, [...CLOSED_STATUSES]),
      ),
    );

  const candidates: DelegatableEvent[] = [];
  for (const row of rows) {
    if (!(await venueInRegion(tx, row.venueProfileId, representation))) continue;
    const details = row.performerDetails as { delegatedToAgentProfileId?: string } | null;
    candidates.push({
      eventId: row.eventId,
      title: row.title,
      alreadyAssigned: details?.delegatedToAgentProfileId === representation.agentProfileId,
    });
  }
  return candidates;
}
