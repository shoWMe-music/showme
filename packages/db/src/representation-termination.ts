import { and, eq, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as schema from "./schema";

/**
 * The EFFECT of a representation termination (decisions.md #14, step 6) — the one
 * implementation, shared by the two callers that must not drift apart:
 *
 *  - `PATCH /representations/:id {action:"terminate"}` with an immediate (or
 *    past-dated) effective moment — the API applies it inside the request; and
 *  - the scheduled sweep (`apps/jobs`), which applies a FUTURE-dated termination
 *    when its notice period finally runs out (audit A-19).
 *
 * WHY IT LIVES IN `@showme/db` AND NOT `apps/api/src/lib`: `apps/jobs` and
 * `apps/api` are sibling apps that must run the byte-identical effect, and this
 * package is the only module both already depend on. It is domain logic over the
 * schema with no framework in it — the same shape as `reference-settlement.ts`.
 * (If a `@showme/representation` package is ever carved out, this file is its
 * first tenant.)
 *
 * Nothing here decides WHETHER a termination is due — that is
 * `isRepresentationActiveAt` in `apps/api/src/lib/representation-rules.ts`, the
 * single reader-side answer to "is this representation live right now?". This
 * module only carries out a termination that has already come due.
 */

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RepresentationRow = typeof schema.representations.$inferSelect;

/** An event that is over (or never happened) is out of the agent's reach. */
export const CLOSED_EVENT_STATUSES = ["concluded", "cancelled"] as const;

/**
 * Reverse assignment on termination (decisions #14 step 6): the performer regains
 * control of every still-OPEN event (not concluded) — the agent participant is
 * removed and the performer un-delegated. Concluded events keep the historical
 * agent row (and any confirmed deal's commission stands via its representation
 * settlement). Returns how many events reverted.
 *
 * "Removed" is `status = 'removed'`, NOT a DELETE — the same soft-remove the
 * participants route and group unassignment use. `authorize()` excludes removed
 * participants, so the agent's access ends the moment this runs, while anything
 * that already pointed at that participation (a computed settlement, a transfer,
 * a budget line's `collected_by`) keeps pointing at a row that still exists.
 * Hard-deleting it made termination impossible the moment money touched the
 * event — either party can terminate unilaterally (decisions #14), always.
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
        notInArray(schema.events.status, [...CLOSED_EVENT_STATUSES]),
        sql`${schema.eventParticipants.details}->>'delegatedToAgentProfileId' = ${representation.agentProfileId}`,
      ),
    );

  let reverted = 0;
  for (const row of rows) {
    // Soft-remove the agent participant from the event (see the note above).
    await tx
      .update(schema.eventParticipants)
      .set({ status: "removed", updatedAt: new Date() })
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

/** What one applied termination did. */
export interface AppliedTermination {
  representation: RepresentationRow;
  /** How many still-open events the performer took back. */
  reverted: number;
}

/**
 * Carry out a termination that is live NOW: flip the row to `terminated` and hand
 * every still-open event back to the performer. Does NOT stamp
 * `terminated_at` / `terminated_effective_at` / `terminated_by` — those record WHO
 * ended it and WHEN it bites, and are written by whoever accepted the termination
 * (the route). This function is only the consequence, so an immediate termination
 * and a swept future-dated one produce exactly the same end state.
 */
export async function applyRepresentationTermination(
  tx: Transaction,
  representation: RepresentationRow,
): Promise<AppliedTermination> {
  const [row] = await tx
    .update(schema.representations)
    .set({ status: "terminated" })
    .where(eq(schema.representations.id, representation.id))
    .returning();
  const terminated = row ?? representation;
  const reverted = await unassignAgentFromOpenEvents(tx, terminated);
  return { representation: terminated, reverted };
}

/**
 * Every representation still standing whose agreed future effective moment has
 * arrived — the sweep's work list. Readers already treat these as inactive from
 * the effective moment (lazy correctness, `isRepresentationActiveAt`); the sweep
 * only makes the STORED state agree, so nothing depends on this having run.
 */
export async function dueRepresentationTerminations(
  database: Database,
  now: Date,
): Promise<RepresentationRow[]> {
  return database
    .select()
    .from(schema.representations)
    .where(
      and(
        eq(schema.representations.status, "active"),
        isNotNull(schema.representations.terminatedEffectiveAt),
        lte(schema.representations.terminatedEffectiveAt, now),
      ),
    );
}
