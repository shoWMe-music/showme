import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { CLOSED_EVENT_STATUSES } from "@showme/db/representation-termination";
import { and, eq, inArray, notInArray } from "drizzle-orm";
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
  if (!existingAgent) {
    const permissionSetId = await agentPermissionSetId(tx, representation.agentProfileId);
    await tx.insert(schema.eventParticipants).values({
      eventId,
      profileId: representation.agentProfileId,
      role: "agent",
      permissionSetId,
      status: "accepted",
    });
  } else if (existingAgent.status === "removed") {
    const permissionSetId = await agentPermissionSetId(tx, representation.agentProfileId);
    await tx
      .update(schema.eventParticipants)
      .set({ role: "agent", permissionSetId, status: "accepted", updatedAt: new Date() })
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
 * Auto-assignment for FUTURE events (decisions #14): when a performer joins an
 * in-region event, any of their ACTIVE representations covering that territory
 * takes control automatically — no per-event opt-in for future events.
 */
export async function autoAssignAgentOnPerformerJoin(
  tx: Transaction,
  event: EventRow,
  performerProfileId: string,
): Promise<void> {
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
  for (const representation of activeReps) {
    if (await venueInRegion(tx, event.venueProfileId, representation)) {
      await assignAgentToEvent(tx, representation, event.id);
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
