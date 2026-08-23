import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, count, countDistinct, eq, gte, inArray, sql } from "drizzle-orm";
import { forbidden } from "../errors";

/**
 * The entitlement layer (PLAN.md §C) — plan limits, kept STRICTLY SEPARATE from
 * authorization (decisions #4). `can_use_feature(profile, feature)` answers "does
 * this profile's plan allow this?", never "may this user do this to that
 * resource?" (that is `authorize`). Composed AFTER `authorize` in a route.
 *
 * Every limit is COMPUTED by a fresh `COUNT` — there are no stored counters. The
 * only persisted money state is the `plans` row and the `credit_ledger`.
 */

export type PlanTier = "free_operator" | "operator_pro" | "free_artist" | "artist_pro";

export type Feature = "create_event" | "send_offer" | "grant_admin" | "not_spam_suspended";

/** The verdict for one feature: allowed, plus the counts behind it when metered. */
export interface FeatureCheck {
  allowed: boolean;
  reason?: string;
  used?: number;
  limit?: number;
}

const PAID_TIERS: readonly PlanTier[] = ["operator_pro", "artist_pro"];

/**
 * The event statuses that CONSUME the free-tier event cap — exactly the set
 * `canUseFeature("create_event")` COUNTs (PLAN.md:613, *"confirm/conclude event
 * when COUNT >= cap -> blocked"*). Declared ONCE so the counter and the gates
 * can never drift apart: whatever is counted here is what every write path that
 * sets `events.status` must gate on.
 */
export const CAP_COUNTING_EVENT_STATUSES = ["confirmed", "concluded"] as const;

/** Does this status sit inside the counted set (i.e. does it consume the cap)? */
export function countsTowardEventCap(status: string | null | undefined): boolean {
  return (CAP_COUNTING_EVENT_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * ADMIN-GRADE capabilities: holding any ONE of these makes a participant an
 * administrator OF THE EVENT — they can reshape who stands on it, hand out
 * authority of their own, or destroy it. This is the narrow, honest core of the
 * `MANAGEMENT_CAPABILITIES` notion in `packages/auth/src/presets.ts`: the routine
 * management grants an ordinary booking needs — `agreement.manage` (every agent
 * holds it), `crew.manage` (every crew lead), `templates.manage` — are
 * deliberately NOT here, because paywalling those would paywall normal booking
 * rather than the act of making someone an admin.
 *
 * The boundary is DELIBERATE, and it is the documented one: PLAN.md:614 draws the
 * line at *"assign `operator_full`/admin permission set to a collaborator"* — at
 * ADMIN, not at edit rights. So plain `event.edit` is intentionally absent: a
 * collaborator who can rename an event has not been made an administrator of it.
 *
 * Whatever writes a permission set onto an `event_participants` row must charge
 * this — the direct writes (`routes/participants.ts`), the deferred one
 * (`routes/invitations.ts`) and the bulk one (`routes/groups.ts`) all funnel
 * through `assertGrantAdminAllows` below.
 */
export const ADMIN_GRADE_CAPABILITIES: readonly Capability[] = [
  "participants.manage",
  "permission.grant_admin",
  "event.delete",
  "members.manage",
];

/** Does this permission set hand its holder admin-grade authority over the event? */
export function confersAdminAuthority(capabilities: readonly string[] | null | undefined): boolean {
  if (!capabilities) return false;
  return capabilities.some((capability) =>
    (ADMIN_GRADE_CAPABILITIES as readonly string[]).includes(capability),
  );
}

/** free_operator may host at most this many live events in a rolling 365 days. */
const FREE_OPERATOR_EVENT_LIMIT = 3;
/** free_artist may send at most this many offers per calendar month. */
const FREE_ARTIST_OFFER_LIMIT = 50;
/** A profile is spam-suspended once this many DISTINCT reporters flag it in 90 days. */
const SPAM_DISTINCT_REPORTER_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function isPaidTier(tier: PlanTier): boolean {
  return PAID_TIERS.includes(tier);
}

/** The free tier a profile falls back to when it has no `plans` row, from its kind. */
function defaultTierForKind(kind: string | undefined): PlanTier {
  return kind === "performer" ? "free_artist" : "free_operator";
}

/** Start of the current calendar month, in UTC. */
function startOfCurrentMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The profile's plan tier — a fresh read of `plans` (never cached with the
 * principal; the entitlement layer always reads current). No row = the free tier
 * for the profile's kind, defaulting to `free_operator` when the profile is
 * unknown.
 */
export async function getPlanTier(db: Database, profileId: string): Promise<PlanTier> {
  const [plan] = await db
    .select({ tier: schema.plans.tier })
    .from(schema.plans)
    .where(eq(schema.plans.profileId, profileId));
  if (plan) return plan.tier as PlanTier;

  const [profile] = await db
    .select({ kind: schema.profiles.kind })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId));
  return defaultTierForKind(profile?.kind);
}

/**
 * Whether the profile's plan permits `feature` right now. Metered features
 * (`create_event`, `send_offer`) report `used`/`limit`; paid tiers are unlimited.
 * `grant_admin` is a pure tier gate; `not_spam_suspended` is a computed reputation
 * gate. `now` is injectable for deterministic tests.
 */
export async function canUseFeature(
  db: Database,
  profileId: string,
  feature: Feature,
  now: Date = new Date(),
): Promise<FeatureCheck> {
  const tier = await getPlanTier(db, profileId);

  switch (feature) {
    case "create_event": {
      // Only free_operator is metered; every other tier hosts without limit.
      if (tier !== "free_operator") return { allowed: true };
      const cutoff = new Date(now.getTime() - 365 * DAY_MS);
      const [row] = await db
        .select({ used: count() })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.hostProfileId, profileId),
            inArray(schema.events.status, [...CAP_COUNTING_EVENT_STATUSES]),
            gte(schema.events.createdAt, cutoff),
          ),
        );
      const used = row?.used ?? 0;
      const limit = FREE_OPERATOR_EVENT_LIMIT;
      return {
        allowed: used < limit,
        used,
        limit,
        reason: used < limit ? undefined : "Free plan event limit reached",
      };
    }

    case "send_offer": {
      // Only free_artist is metered; every other tier sends without limit.
      if (tier !== "free_artist") return { allowed: true };
      const [profile] = await db
        .select({ ownerUserId: schema.profiles.ownerUserId })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profileId));
      const ownerUserId = profile?.ownerUserId;
      const monthStart = startOfCurrentMonth(now);
      const [row] = ownerUserId
        ? await db
            .select({ used: count() })
            .from(schema.bookingRequests)
            .where(
              and(
                eq(schema.bookingRequests.source, "performer_offer"),
                eq(schema.bookingRequests.senderUserId, ownerUserId),
                gte(schema.bookingRequests.createdAt, monthStart),
              ),
            )
        : [{ used: 0 }];
      const used = row?.used ?? 0;
      const limit = FREE_ARTIST_OFFER_LIMIT;
      return {
        allowed: used < limit,
        used,
        limit,
        reason: used < limit ? undefined : "Monthly offer limit reached",
      };
    }

    case "grant_admin": {
      const allowed = isPaidTier(tier);
      return { allowed, reason: allowed ? undefined : "Granting admin requires a paid plan" };
    }

    case "not_spam_suspended": {
      const cutoff = new Date(now.getTime() - 90 * DAY_MS);
      const [row] = await db
        .select({ reporters: countDistinct(schema.spamFlags.reporterProfileId) })
        .from(schema.spamFlags)
        .where(
          and(
            eq(schema.spamFlags.targetProfileId, profileId),
            gte(schema.spamFlags.createdAt, cutoff),
          ),
        );
      const used = row?.reporters ?? 0;
      const limit = SPAM_DISTINCT_REPORTER_LIMIT;
      return {
        allowed: used < limit,
        used,
        limit,
        reason: used < limit ? undefined : "Profile suspended for spam reports",
      };
    }
  }
}

/** The profile's collaboration-credit balance — `SUM(credit_ledger.delta)`, never stored. */
export async function creditBalance(db: Database, profileId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)` })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.profileId, profileId));
  return Number(row?.total ?? 0);
}

/**
 * THE event-cap gate — one helper for EVERY write path that sets `events.status`
 * (`routes/events.ts` PATCH, `routes/holds.ts` confirm and its cascade). PLAN.md:613
 * meters *confirm/conclude*, not one field value: gating only `confirmed` left
 * `PATCH {"status":"concluded"}` as a free door straight past the cap (audit A-20).
 *
 * The rule: a transition INTO `CAP_COUNTING_EVENT_STATUSES` from OUTSIDE it must
 * pass. A move that stays inside the set (`confirmed` -> `concluded`) consumes
 * nothing new and is never gated; a move that LEAVES it (-> `cancelled`, -> `draft`)
 * is never gated either.
 *
 * Charged to the event's HOST profile — the plan that pays for the event.
 *
 * ENTITLEMENT, not authorization (decisions #4): `authorize()` answers "may this
 * principal touch this event"; this answers "does the host's plan allow one more
 * live event". Always composed AFTER `authorize()` in the route, never folded into it.
 */
export async function assertEventCapAllows(
  database: Database,
  event: { hostProfileId: string; status: string },
  nextStatus: string | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!countsTowardEventCap(nextStatus)) return;
  if (countsTowardEventCap(event.status)) return;

  const gate = await canUseFeature(database, event.hostProfileId, "create_event", now);
  if (!gate.allowed) {
    throw forbidden(gate.reason ?? "Event cap reached — upgrade to confirm more events");
  }
}

/**
 * THE grant-admin gate for EVENT-level authority — every path that can put a
 * permission set on an `event_participants` row: `routes/participants.ts` (create +
 * update), `routes/invitations.ts` (create + accept: an invitation is a deferred
 * grant) and `routes/groups.ts` (a group assignment, override or member defaults).
 * PLAN.md:614/615/656, *"assign `operator_full`/admin permission set to a
 * collaborator -> requires host plan in paid"*. Same rule and same 403 shape as the
 * profile-member `admin` promotion in `routes/profiles.ts`; there was no second rule
 * to invent (audit A-21).
 *
 * Only a grant that ADDS admin authority is gated: re-saving the set a participant
 * already holds, or swapping one admin-grade set for another, consumes nothing new —
 * mirroring `promotingToAdmin` (`role === "admin" && before.role !== "admin"`) in
 * `routes/profiles.ts`.
 *
 * Charged to the EVENT HOST's profile — the plan that pays for the event, exactly as
 * `create_event` is charged in `routes/events.ts`. The collaborator receiving the
 * authority never pays for it.
 *
 * ENTITLEMENT, not authorization (decisions #4) — composed AFTER `authorize()`.
 */
export async function assertGrantAdminAllows(
  database: Database,
  grant: {
    hostProfileId: string;
    nextPermissionSetId: string | null | undefined;
    currentPermissionSetId?: string | null;
  },
): Promise<void> {
  const { hostProfileId, nextPermissionSetId, currentPermissionSetId = null } = grant;
  if (!nextPermissionSetId || nextPermissionSetId === currentPermissionSetId) return;

  const permissionSetIds = currentPermissionSetId
    ? [nextPermissionSetId, currentPermissionSetId]
    : [nextPermissionSetId];
  const rows = await database
    .select({
      id: schema.permissionSets.id,
      capabilities: schema.permissionSets.capabilities,
    })
    .from(schema.permissionSets)
    .where(inArray(schema.permissionSets.id, permissionSetIds));

  const next = rows.find((row) => row.id === nextPermissionSetId);
  if (!confersAdminAuthority(next?.capabilities)) return;
  const current = rows.find((row) => row.id === currentPermissionSetId);
  if (confersAdminAuthority(current?.capabilities)) return;

  const gate = await canUseFeature(database, hostProfileId, "grant_admin");
  if (!gate.allowed) throw forbidden(gate.reason ?? "Granting admin requires a paid plan");
}
