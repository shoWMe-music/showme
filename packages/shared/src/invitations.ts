/**
 * How long an invitation stays open.
 *
 * These numbers are shared because **two places must agree or the product
 * lies**: `POST /invitations` stamps `expires_at` when the invitation is minted,
 * and `apps/jobs`'s reaper flips the row to `expired` some time later. If the
 * column said 90 days while the sweeper reaped at 30, the recipient would be
 * told one thing by the page and another by the database — which is the exact
 * class of drift the rebuild exists to delete.
 *
 * `expires_at` is the authority: it is read on every redemption
 * (`routes/invitations.ts`), so the rule is enforced the moment it applies,
 * without waiting for a sweep. The reaper only converges the stored `status` so
 * the roster and the reports stop counting a dead invitation as outstanding —
 * per `verify-e2e`, anything a cron job reconciles must already be correct
 * without it.
 *
 * The two durations, and why they differ:
 *
 * - **90 days for a venue handoff.** It is a business negotiation with a venue
 *   that may not be on the platform at all yet, and it was already the product's
 *   number (`reapExpiredHandoffs`) before anything wrote the column.
 * - **30 days for everything else.** A collaborator or team invitation is about
 *   a booking in progress; a month is generous for an answer, and it matches the
 *   30 days a performer offer already gets (`reapExpiredOffers`). An invitation
 *   that stays live forever is a standing grant nobody remembers issuing.
 */
export const INVITATION_EXPIRY_DAYS = 30;
export const VENUE_HANDOFF_EXPIRY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment an invitation minted `from` this source stops being redeemable. */
export function invitationExpiresAt(source: string, from: Date): Date {
  const days = source === "venue_handoff" ? VENUE_HANDOFF_EXPIRY_DAYS : INVITATION_EXPIRY_DAYS;
  return new Date(from.getTime() + days * DAY_MS);
}
