import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as schema from "./schema";

/**
 * The 90-day erasure of unclaimed stub accounts (docs/gdpr.md; Ran's invitation
 * spec, "if no acceptance within 90 days, auto-created accounts are hard-deleted").
 *
 * WHAT A STUB IS AND WHY IT CANNOT SIT THERE. Two paths mint a profile that no
 * person has claimed — an operator adding an off-platform performer
 * (`apps/api/src/lib/off-platform.ts`) and a venue handoff
 * (`apps/api/src/routes/inbound.ts`). Both write a real person's NAME and, in
 * `profile_members`, their EMAIL — onto an account that person never asked for
 * and may never have heard of. That is the personal data this deletes.
 *
 * WHAT SURVIVES, AND WHY IT IS NOT A LOOPHOLE. Daniel, 2026-09-01: "Every
 * unclaimed stub over 90 days. But it should keep the names in the events, not as
 * accounts but just as a name / contact, so it doesn't break the events." So the
 * account goes — profile, membership, email, media, locations, payout details —
 * and one field is kept where the person appeared on a bill:
 * `event_participants.display_name`, plus `events.venue_name` for a handoff stub.
 * A name on a show that happened is a business record of that show, and the
 * alternative is a settled event whose bill has a hole in it.
 *
 * WHY IT LIVES IN `@showme/db`: the same reason as `representation-termination.ts`
 * beside it — domain logic over the schema with no framework in it, in the one
 * package both `apps/jobs` and `apps/api` already depend on.
 *
 * ── THE PART THAT DESERVES THE CARE ──────────────────────────────────────────
 * `profiles` is referenced by 38 foreign keys, 15 of them RESTRICT. A delete that
 * ignores them either fails outright (and the job silently reaps nothing for
 * months) or, if someone "fixes" it by cascading, quietly destroys events. Each
 * one is therefore decided here, out loud, in one of four ways:
 *
 *   KEEP THE NAME  the reference is a bill or a venue line — copy the name across
 *                  and null the pointer (`event_participants`, `events`).
 *   CLEAR          the reference is incidental and the column is nullable — an
 *                  actor on a log line, an uploader, a sender. Null it.
 *   DELETE         the row is the stub's own data and nothing else refers to it.
 *   REFUSE         the row is a record we have no business destroying. The whole
 *                  profile is skipped, with a reason, and reported.
 *
 * A REFUSAL IS REPORTED, NEVER SWALLOWED. A purge that quietly skips half its
 * candidates looks identical to one that had nothing to do — and "we deleted it"
 * is a claim we may have to stand behind. Every skip comes back in the result
 * with the reason, and `apps/jobs/src/index.ts` logs them.
 */

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** How long an unclaimed account may sit before it is erased. */
export const STUB_PURGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A profile the purge declined to touch, and the record that stopped it. */
export interface SkippedStub {
  profileId: string;
  name: string;
  reason: string;
}

export interface StubPurgeResult {
  /** Profiles erased. */
  purged: number;
  /** Profiles left alone because erasing them would have destroyed a real record. */
  skipped: SkippedStub[];
}

interface StubCandidate {
  id: string;
  name: string;
}

/**
 * The stubs old enough to go: unclaimed, and created more than 90 days ago.
 *
 * The age is measured from `profiles.created_at` rather than from the invitation,
 * because a stub can outlive every invitation that ever pointed at it (they are
 * `ON DELETE CASCADE` from the profile, and a handoff can be re-sent). The
 * profile's own age is the one clock that always exists and only moves forward.
 *
 * Deliberately NOT filtered by invitation status. Ran's spec framed it as "no
 * acceptance within 90 days"; Daniel's rule is "every unclaimed stub over 90
 * days", which is the wider set and the one implemented — an invitation still
 * marked `pending` after three months is not a live conversation, it is a row
 * nobody ever answered.
 */
export async function dueStubProfiles(db: Database, now: Date): Promise<StubCandidate[]> {
  const cutoff = new Date(now.getTime() - STUB_PURGE_DAYS * DAY_MS);
  return db
    .select({ id: schema.profiles.id, name: schema.profiles.name })
    .from(schema.profiles)
    .where(and(isNull(schema.profiles.claimedAt), lt(schema.profiles.createdAt, cutoff)));
}

/**
 * The records that make a profile un-erasable, checked before anything is
 * written. Returns a reason, or null when the stub is free to go.
 *
 * These are the four RESTRICT references whose column is NOT NULL, or whose NULL
 * means something else entirely — so there is no way to keep the row and drop the
 * pointer. Rather than delete somebody's show, budget, share or royalty filing to
 * satisfy a retention job, the purge stops and says which one stopped it.
 */
async function refusalReason(tx: Transaction, profileId: string): Promise<string | null> {
  const [hosted] = await tx
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.hostProfileId, profileId))
    .limit(1);
  // `events.host_profile_id` is NOT NULL: there is no way to keep the event and
  // let go of its host. A stub should never be one — both minting paths hand
  // hosting to the operator who did the minting — so this firing means the data
  // is not what we think it is, which is exactly when not to delete anything.
  if (hosted) return "hosts an event";

  const [share] = await tx
    .select({ id: schema.shares.id })
    .from(schema.shares)
    .where(eq(schema.shares.ownerProfileId, profileId))
    .limit(1);
  if (share) return "owns a share link";

  // `budgets.owner_profile_id` is nullable, but the NULL is not spare capacity —
  // it is what distinguishes a SHARED budget from a private one. Clearing it here
  // would silently publish a private budget to every party on the event.
  const [budget] = await tx
    .select({ id: schema.budgets.id })
    .from(schema.budgets)
    .where(eq(schema.budgets.ownerProfileId, profileId))
    .limit(1);
  if (budget) return "owns a private budget";

  const [report] = await tx
    .select({ id: schema.performanceReports.id })
    .from(schema.performanceReports)
    .where(eq(schema.performanceReports.filedByProfileId, profileId))
    .limit(1);
  // A filing to a performing-rights society is a royalty record with a life of
  // its own outside this system. Not ours to delete on a timer.
  if (report) return "filed a performing-rights report";

  return null;
}

/**
 * Erase one stub, inside the caller's transaction. Ordered so that every RESTRICT
 * reference is gone before the profile itself is deleted; the ~23 CASCADE
 * references (membership and its email, media, locations, social links, payout
 * accounts, custom roles, group membership, venue details, templates, calendar
 * connections, unavailability, permission sets, plans, credit ledger, contacts,
 * riders, invoices, stages, and the booking requests and invitations addressed to
 * it) are left to the database, which is better at it than a hand-written list.
 */
async function erase(tx: Transaction, stub: StubCandidate): Promise<void> {
  // ── KEEP THE NAME ──────────────────────────────────────────────────────────
  // The bill. `display_name` is written from the profile's name at this moment,
  // which is the last moment it exists; `permission_set_id` goes with it, because
  // a row that grants nobody anything has no use for a permission set (and the
  // set itself is about to be cascaded away).
  await tx
    .update(schema.eventParticipants)
    .set({ displayName: stub.name, profileId: null, permissionSetId: null, updatedAt: new Date() })
    .where(eq(schema.eventParticipants.profileId, stub.id));

  // The venue line, for a handoff stub. `events.venue_name` already exists and is
  // already what the app falls back to, so the name lands somewhere readers
  // understand. COALESCE, never overwrite: a venue name typed by hand is the
  // operator's own words and outranks a stub's account name.
  await tx
    .update(schema.events)
    .set({
      venueName: sql`coalesce(${schema.events.venueName}, ${stub.name})`,
      venueProfileId: null,
    })
    .where(eq(schema.events.venueProfileId, stub.id));

  // Any participant row pointing at a permission set this profile owned — the
  // sets are about to cascade, and `event_participants.permission_set_id` is
  // RESTRICT, so it would block the delete from a row we have not touched above.
  const ownedSets = await tx
    .select({ id: schema.permissionSets.id })
    .from(schema.permissionSets)
    .where(eq(schema.permissionSets.profileId, stub.id));
  if (ownedSets.length > 0) {
    await tx
      .update(schema.eventParticipants)
      .set({ permissionSetId: null, updatedAt: new Date() })
      .where(
        inArray(
          schema.eventParticipants.permissionSetId,
          ownedSets.map((row: { id: string }) => row.id),
        ),
      );
  }

  // ── CLEAR ──────────────────────────────────────────────────────────────────
  // Incidental references on nullable columns. A stub never acts, so most of
  // these are empty in practice; they are cleared anyway because "in practice" is
  // not a constraint and this job must not fail at 3am on a row nobody expected.
  await tx
    .update(schema.activityLog)
    .set({ actorProfileId: null })
    .where(eq(schema.activityLog.actorProfileId, stub.id));
  await tx
    .update(schema.auditLog)
    .set({ actingProfileId: null })
    .where(eq(schema.auditLog.actingProfileId, stub.id));
  await tx
    .update(schema.tasks)
    .set({ ownerProfileId: null })
    .where(eq(schema.tasks.ownerProfileId, stub.id));
  await tx
    .update(schema.files)
    .set({ ownerProfileId: null })
    .where(eq(schema.files.ownerProfileId, stub.id));
  await tx
    .update(schema.invitations)
    .set({ createdByProfile: null })
    .where(eq(schema.invitations.createdByProfile, stub.id));
  // The offers this stub sent or was pitched on behalf of. The REQUEST survives —
  // it is the recipient venue's inbox and their record of the conversation — but
  // it stops naming a profile that no longer exists.
  await tx
    .update(schema.bookingRequests)
    .set({ senderProfileId: null })
    .where(eq(schema.bookingRequests.senderProfileId, stub.id));
  await tx
    .update(schema.bookingRequests)
    .set({ onBehalfOfProfileId: null })
    .where(eq(schema.bookingRequests.onBehalfOfProfileId, stub.id));

  // ── DELETE ─────────────────────────────────────────────────────────────────
  // The stub's own calendar. Nothing outside the profile refers to it, and it is
  // as personal as the email.
  await tx.delete(schema.calendarItems).where(eq(schema.calendarItems.ownerProfileId, stub.id));
  // Spam reports FILED BY the stub. `reporter_profile_id` is NOT NULL, so there
  // is no clearing it; a report from an account that never had a person behind it
  // is not evidence worth keeping. (Reports filed AGAINST it cascade.)
  await tx.delete(schema.spamFlags).where(eq(schema.spamFlags.reporterProfileId, stub.id));
  // Representation agreements on either side. Both columns are NOT NULL, and an
  // agreement with an erased party is not an agreement.
  await tx
    .delete(schema.representations)
    .where(
      or(
        eq(schema.representations.agentProfileId, stub.id),
        eq(schema.representations.performerProfileId, stub.id),
      ),
    );
  // Address-book entries created FROM an invitation that is about to cascade away
  // with the profile. `contacts.invitation_id` is RESTRICT, and the contact
  // itself belongs to whoever wrote it down, so the link is cleared and the
  // contact kept — the operator's own note of a person is theirs, not the stub's.
  const doomedInvitations = await tx
    .select({ id: schema.invitations.id })
    .from(schema.invitations)
    .where(eq(schema.invitations.targetProfileId, stub.id));
  if (doomedInvitations.length > 0) {
    await tx
      .update(schema.contacts)
      .set({ invitationId: null, updatedAt: new Date() })
      .where(
        inArray(
          schema.contacts.invitationId,
          doomedInvitations.map((row: { id: string }) => row.id),
        ),
      );
  }

  // ── AND THE ACCOUNT ITSELF ─────────────────────────────────────────────────
  // Everything else cascades from here, including `profile_members` — which is
  // where the email lives, and the whole reason this job exists.
  await tx.delete(schema.profiles).where(eq(schema.profiles.id, stub.id));
}

/**
 * Erase every stub that has run out of time, one transaction each so a single
 * blocked profile never holds back the rest of the night's work — the same shape
 * `reapDueRepresentationTerminations` uses, and for the same reason.
 */
export async function purgeUnclaimedStubProfiles(
  db: Database,
  now: Date,
): Promise<StubPurgeResult> {
  const due = await dueStubProfiles(db, now);
  const result: StubPurgeResult = { purged: 0, skipped: [] };

  for (const stub of due) {
    await db.transaction(async (tx) => {
      const reason = await refusalReason(tx, stub.id);
      if (reason) {
        result.skipped.push({ profileId: stub.id, name: stub.name, reason });
        return;
      }
      await erase(tx, stub);
      result.purged += 1;
    });
  }

  return result;
}
