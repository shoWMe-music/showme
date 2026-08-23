import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { isRepresentationActiveAt } from "@showme/shared";
import { and, eq, ne, sql } from "drizzle-orm";

/**
 * Which delegations on one event are LIVE right now.
 *
 * `event_participants.details.delegatedToAgentProfileId` is a **materialized
 * projection** of the standing representation (decisions #14) — written when the
 * performer hands an event over, cleared when the agreement ends. That works while
 * the two are written in the same transaction, which is what an *immediate*
 * termination does. An **effective-dated** termination breaks the assumption: from
 * the agreed moment the agreement is over, but the flag survives until the
 * `apps/jobs` sweep runs (audit A-19 follow-up).
 *
 * Trusting the flag alone in that window costs both ways: the agent keeps reading
 * an event they no longer represent anyone on, and — worse — the performer who
 * fired them stays locked into view-only, unable to confirm their own deal, until
 * a cron fires. Authorization must never wait on a reaper.
 *
 * So the flag is only ever the *candidate*; the representation is the authority.
 * This is one keyed query — `event_participants` by `event_id` (indexed) joined to
 * the representation the flag names — and it is deliberately a separate query from
 * the capability composition rather than another join onto it: that join is keyed
 * by `event_id + user_id` and returns only the CALLER's rows, while the agent's
 * standing depends on OTHER participants' delegations on the same event. One query
 * per question, each keyed by the event.
 */
export interface LiveDelegation {
  /** The delegating performer's participation on this event. */
  performerParticipantId: string;
  performerProfileId: string;
  /** The agent profile the performer's action capabilities currently sit with. */
  agentProfileId: string;
}

export async function liveEventDelegations(
  db: Database,
  eventId: string,
  now: Date = new Date(),
): Promise<LiveDelegation[]> {
  const rows = await db
    .select({
      performerParticipantId: schema.eventParticipants.id,
      performerProfileId: schema.eventParticipants.profileId,
      agentProfileId: schema.representations.agentProfileId,
      status: schema.representations.status,
      terminatedEffectiveAt: schema.representations.terminatedEffectiveAt,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.representations,
      and(
        eq(schema.representations.performerProfileId, schema.eventParticipants.profileId),
        sql`${schema.representations.agentProfileId}::text = ${schema.eventParticipants.details}->>'delegatedToAgentProfileId'`,
      ),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
        // The SQL prefilter only — a row can be `active` and already past its
        // agreed effective moment. `isRepresentationActiveAt` is the answer.
        eq(schema.representations.status, "active"),
      ),
    );

  return rows
    .filter((row) => isRepresentationActiveAt(row, now))
    .map((row) => ({
      performerParticipantId: row.performerParticipantId,
      performerProfileId: row.performerProfileId,
      agentProfileId: row.agentProfileId,
    }));
}
