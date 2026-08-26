import { type Database, schema } from "@showme/db";
import {
  applyRepresentationTermination,
  dueRepresentationTerminations,
} from "@showme/db/representation-termination";
import { VENUE_HANDOFF_EXPIRY_DAYS } from "@showme/shared";
import { and, eq, isNull, lt, or } from "drizzle-orm";

/**
 * Retention / duration reapers (decisions #10/#11, docs/gdpr.md + timezones.md).
 *
 * These are all **duration-based** expiries computed from a UTC `created_at`
 * (instant + interval) — so there is no time-zone subtlety, per docs/timezones.md.
 * `now` is injected rather than read from the clock so the jobs are deterministic
 * under test. Each reaper returns the number of rows it changed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFER_EXPIRY_DAYS = 30;

/**
 * Expire stale performer offers: `booking_requests` with `source='performer_offer'`
 * still `pending` older than 30 days → `expired`.
 */
export async function reapExpiredOffers(database: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - OFFER_EXPIRY_DAYS * DAY_MS);
  const expired = await database
    .update(schema.bookingRequests)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(schema.bookingRequests.source, "performer_offer"),
        eq(schema.bookingRequests.status, "pending"),
        lt(schema.bookingRequests.createdAt, cutoff),
      ),
    )
    .returning({ id: schema.bookingRequests.id });
  return expired.length;
}

/**
 * Converge the stored `status` of invitations that have run out: any `pending`
 * one whose `expires_at` has passed → `expired`.
 *
 * This USED to be the whole rule, computed from `created_at` and applied only to
 * venue handoffs — because `expires_at` was a column nothing ever wrote. Now
 * `POST /invitations` and `POST /events/:id/handoff` both stamp it from the same
 * shared durations, so the column is the authority and this sweep only tidies up
 * behind it. Every read path already refuses an expired invitation on its own
 * (`routes/invitations.ts`), which is the order that matters: correct without the
 * cron, converged by it.
 *
 * The second clause is for the rows that existed BEFORE the column was armed —
 * legacy handoffs with a null `expires_at`, which would otherwise stay `pending`
 * forever now that the created_at rule has gone. It keeps the 90-day number it
 * always had, from the same constant the writer uses.
 *
 * (Kept under its original name because that is what `apps/jobs/src/index.ts`
 * reports as `handoffs` in the sweep summary and what Cloud Scheduler's logs have
 * always shown.)
 */
export async function reapExpiredHandoffs(database: Database, now: Date): Promise<number> {
  const legacyCutoff = new Date(now.getTime() - VENUE_HANDOFF_EXPIRY_DAYS * DAY_MS);
  const expired = await database
    .update(schema.invitations)
    .set({ status: "expired" })
    .where(
      and(
        eq(schema.invitations.status, "pending"),
        or(
          lt(schema.invitations.expiresAt, now),
          and(
            isNull(schema.invitations.expiresAt),
            eq(schema.invitations.source, "venue_handoff"),
            lt(schema.invitations.createdAt, legacyCutoff),
          ),
        ),
      ),
    )
    .returning({ id: schema.invitations.id });
  return expired.length;
}

/**
 * Retire expired shares: any not-yet-revoked `share` whose `expires_at` has passed
 * is revoked (`revoked_at = now`), and any expired one-time passcodes are deleted.
 * Returns the number of shares revoked.
 */
export async function reapExpiredShares(database: Database, now: Date): Promise<number> {
  const revoked = await database
    .update(schema.shares)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(lt(schema.shares.expiresAt, now), isNull(schema.shares.revokedAt)))
    .returning({ id: schema.shares.id });

  await database.delete(schema.shareOtps).where(lt(schema.shareOtps.expiresAt, now));

  return revoked.length;
}

/**
 * Land the agreed-future representation terminations whose moment has arrived
 * (decisions #14: "immediate or agreed-future"; audit A-19).
 *
 * This job is CONVERGENCE, not correctness. A future-dated termination leaves the
 * row `active` with `terminated_effective_at` stamped, and every reader already
 * asks `isRepresentationActiveAt` — so the agent's authority, their auto-assignment
 * onto new events and their commission all stop at the effective instant whether or
 * not this has run. What this does is make the STORED state say the same thing:
 * flip the status and hand the performer back every still-open event, through
 * `applyRepresentationTermination` — the exact code path an immediate termination
 * takes in the API, so the two can never drift into different end states.
 *
 * Each representation gets its own transaction: one that fails (a locked
 * participant row, say) must not hold back the rest of the day's terminations.
 * Returns the number of representations terminated.
 */
export async function reapDueRepresentationTerminations(
  database: Database,
  now: Date,
): Promise<number> {
  const due = await dueRepresentationTerminations(database, now);
  let terminated = 0;
  for (const representation of due) {
    await database.transaction(async (tx) => {
      await applyRepresentationTermination(tx, representation);
    });
    terminated += 1;
  }
  return terminated;
}
