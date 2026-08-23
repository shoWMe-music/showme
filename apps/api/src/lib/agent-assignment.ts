import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Transaction } from "./audit";

type RepresentationRow = typeof schema.representations.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

/** An event that is over (or never happened) is out of the agent's reach. */
const CLOSED_STATUSES = ["concluded", "cancelled"] as const;

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

  // Materialize the agent participant (skip if already present).
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
  const activeReps = await tx
    .select()
    .from(schema.representations)
    .where(
      and(
        eq(schema.representations.performerProfileId, performerProfileId),
        eq(schema.representations.status, "active"),
      ),
    );
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

/**
 * Reverse assignment on termination (decisions #14 step 6): the performer regains
 * control of every still-OPEN event (not concluded) — the agent participant is
 * removed and the performer un-delegated. Concluded events keep the historical
 * agent row (and any confirmed deal's commission stands via its representation
 * settlement). Returns how many events reverted.
 */
export async function unassignAgentFromOpenEvents(
  tx: Transaction,
  representation: RepresentationRow,
): Promise<number> {
  // Events where this performer is delegated to this agent, still open.
  const rows = await tx
    .select({
      participantId: schema.eventParticipants.id,
      eventId: schema.eventParticipants.eventId,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
    .where(
      and(
        eq(schema.eventParticipants.profileId, representation.performerProfileId),
        notInArray(schema.events.status, [...CLOSED_STATUSES]),
        sql`${schema.eventParticipants.details}->>'delegatedToAgentProfileId' = ${representation.agentProfileId}`,
      ),
    );

  let reverted = 0;
  for (const row of rows) {
    // Remove the agent participant from the event.
    await tx
      .delete(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, row.eventId),
          eq(schema.eventParticipants.profileId, representation.agentProfileId),
          eq(schema.eventParticipants.role, "agent"),
        ),
      );
    // Un-delegate the performer (drop the flag, keep any other details).
    const previous = (row.details as Record<string, unknown> | null) ?? {};
    const details = Object.fromEntries(
      Object.entries(previous).filter(([key]) => key !== "delegatedToAgentProfileId"),
    );
    await tx
      .update(schema.eventParticipants)
      .set({ details, updatedAt: new Date() })
      .where(eq(schema.eventParticipants.id, row.participantId));
    reverted += 1;
  }
  return reverted;
}
