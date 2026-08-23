/**
 * Representation LIFECYCLE predicates — pure, no I/O, no schema.
 *
 * These live in `@showme/shared` because the question "is this agent↔performer
 * agreement live right now?" is asked by three layers that cannot import each
 * other: the authorization engine (`@showme/auth`), the API's domain rules
 * (`apps/api/src/lib/representation-rules.ts`, which re-exports them so its call
 * sites and comments read unchanged) and the scheduled sweep (`apps/jobs`). One
 * definition, or the notice-period window means three different things.
 */

/** The minimum a representation row must carry to answer the liveness question. */
export interface RepresentationLifecycle {
  status: string;
  terminatedEffectiveAt: Date | null;
}

/**
 * Is this representation live at `now`? THE single answer — every reader of
 * "active representations" (the capability engine, deal authority, agent
 * assignment, commission settlement, the disjoint-region checks) goes through
 * here, because a row's `status` column alone is not the truth.
 *
 * A termination may be **effective-dated** into the future (decisions.md #14:
 * "immediate or agreed-future"). During that notice period the agreement is still
 * running — the agent keeps negotiating, keeps being auto-assigned onto new
 * in-region events, keeps earning commission — so the row stays `active` with the
 * effective moment stamped on it, and only becomes inert when that moment passes.
 *
 * The comparison is done here rather than left to a background job on purpose: the
 * sweep in `apps/jobs` makes the STORED state converge, but correctness must never
 * wait on a cron. A row whose moment has passed is dead to every reader the
 * instant it passes, swept or not (audit A-19).
 */
export function isRepresentationActiveAt(
  representation: RepresentationLifecycle,
  now: Date,
): boolean {
  if (representation.status !== "active") return false;
  const effectiveAt = representation.terminatedEffectiveAt;
  return effectiveAt === null || effectiveAt.getTime() > now.getTime();
}

/**
 * Is this an active representation working out an agreed notice period — a
 * termination accepted, dated, and not yet bitten? Purely informational (the API
 * surfaces `terminatedEffectiveAt` either way); liveness is `isRepresentationActiveAt`.
 */
export function isPendingTermination(representation: RepresentationLifecycle, now: Date): boolean {
  return (
    representation.status === "active" &&
    representation.terminatedEffectiveAt !== null &&
    representation.terminatedEffectiveAt.getTime() > now.getTime()
  );
}

/**
 * Does a termination requested now, effective at `effectiveAt`, bite immediately?
 * A missing date means now. A past or present date means now (you cannot back-date
 * the notice you already served, but you can decline to serve one). Only a
 * genuinely future moment on an ALREADY-ACTIVE agreement becomes a notice period:
 * a merely `proposed` offer has no work to keep doing, so withdrawing it is always
 * immediate whatever date is attached.
 */
export function terminationTakesEffectNow(status: string, effectiveAt: Date, now: Date): boolean {
  if (status !== "active") return true;
  return effectiveAt.getTime() <= now.getTime();
}
