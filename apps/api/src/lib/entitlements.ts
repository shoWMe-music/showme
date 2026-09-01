import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, count, countDistinct, eq, gte, inArray, sql } from "drizzle-orm";
import { HttpError } from "../errors";
import type { Transaction } from "./audit";

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

export type Feature =
  | "create_event"
  | "send_offer"
  | "grant_admin"
  | "not_spam_suspended"
  | "send_external_invite";

/** The verdict for one feature: allowed, plus the counts behind it when metered. */
export interface FeatureCheck {
  allowed: boolean;
  reason?: string;
  used?: number;
  limit?: number;
}

/**
 * The error CODE every plan-limit refusal carries — `403 entitlement_required`,
 * deliberately NOT the plain `forbidden` that an authorization refusal uses.
 *
 * The two 403s mean opposite things and deserve opposite answers. "You may not
 * touch this event" is a standing problem the user cannot fix by paying; "your
 * plan does not include this" is a purchase away. Until this code existed the UI
 * could only tell them apart by matching on message TEXT, which is how upgrade
 * prompts end up hardcoded into a dozen screens and drifting from the rule.
 * `apps/web/src/lib/errors.ts::isEntitlementError` reads exactly this code, so
 * ONE component answers every plan gate in the app.
 */
export const ENTITLEMENT_REQUIRED_CODE = "entitlement_required";

/**
 * The features that a PAID PLAN unlocks — the only ones whose refusal is an
 * upgrade prompt. `not_spam_suspended` is deliberately absent: it is a reputation
 * gate, and answering a suspended profile with "upgrade to Pro" would be both
 * wrong and insulting. It stays an ordinary `forbidden`.
 */
const PLAN_GATED_FEATURES: readonly Feature[] = ["create_event", "send_offer", "grant_admin"];
// `send_external_invite` is deliberately absent, for the same reason
// `not_spam_suspended` is: running out of invitation credits is not a purchase
// away. Daniel, 2026-09-01: "It's a cap based on response. So when they get a
// response they get 1 back. Potentially we could offer a non-cap pro version
// when we build the pro for performers." Until that plan exists, answering an
// empty balance with "upgrade" would be selling something we do not sell.

/** Is a refusal of this feature an upgrade prompt, or an ordinary refusal? */
export function isPlanGatedFeature(feature: Feature): boolean {
  return PLAN_GATED_FEATURES.includes(feature);
}

/**
 * Build the 403 for a refused entitlement. The MESSAGE stays the specific,
 * factual reason ("Free plan event limit reached") — it is what an API consumer
 * and the audit log read; the upgrade SENTENCE belongs to the UI and lives in one
 * component, not in this file and not in each route.
 */
export function entitlementRequired(feature: Feature, check: FeatureCheck): HttpError {
  const message = check.reason ?? "Your plan does not include this feature";
  if (!isPlanGatedFeature(feature)) return new HttpError(403, message, "forbidden");
  return new HttpError(403, message, ENTITLEMENT_REQUIRED_CODE);
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
/**
 * How many EXTERNAL collaboration invitations a free performer may have out at
 * once — Ran's spec, "20 credits, +1 per accepted invite".
 *
 * It is an ALLOWANCE, not a stored balance, and deliberately not a ledger row:
 * granting it as a row would need a backfill for every profile that already
 * exists and a hook on every profile created after, and the number would then
 * live in two places. `collaborationCreditBalance` is this constant plus the
 * ledger's sum, so a profile that has never sent anything reads 20 without a
 * single row having been written for it.
 */
export const COLLABORATION_INVITE_CREDITS = 20;

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

    case "send_external_invite": {
      // PERFORMERS ONLY (Daniel, 2026-09-01). Ran's spec caps performers and
      // leaves venues unlimited because "curating their roster is natural quality
      // filtering"; it says nothing about the other two kinds, and the call was to
      // read it literally. An agency doing volume outreach is the obvious next
      // candidate — noted, not assumed.
      const [profile] = await db
        .select({ kind: schema.profiles.kind })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profileId));
      if (profile?.kind !== "performer") return { allowed: true };
      // A paid artist plan lifts the cap — the "non-cap pro version" this is
      // waiting for. Until that plan is sold, nobody is on this branch.
      if (tier !== "free_artist") return { allowed: true };

      const balance = await collaborationCreditBalance(db, profileId);
      // `used` is what is OUTSTANDING, not what was ever sent: a refill on answer
      // means the number on screen is "invitations waiting on a reply".
      const used = COLLABORATION_INVITE_CREDITS - balance;
      return {
        allowed: balance > 0,
        used,
        limit: COLLABORATION_INVITE_CREDITS,
        reason:
          balance > 0
            ? undefined
            : "All 20 invitations are waiting for a reply. You get one back each time somebody answers.",
      };
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

/**
 * How many external collaboration invitations this profile may still send —
 * the opening allowance plus every movement since, computed, never stored.
 *
 * The ledger holds only what HAPPENED: `-1` when an invitation goes to somebody
 * who is not on shoWMe, `+1` when that invitation is answered. The allowance is
 * a constant rather than a row, so the number is right for profiles that predate
 * this feature without any backfill (see `COLLABORATION_INVITE_CREDITS`).
 *
 * A consequence worth naming, because it is the product rule stated in arithmetic:
 * a refill only ever follows a spend, so the balance can never exceed the
 * allowance, and "20 credits" means **20 unanswered invitations at a time** — not
 * 20 for all time. Sending into the void is what costs; being turned down is not.
 */
export async function collaborationCreditBalance(db: Database, profileId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)` })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.profileId, profileId));
  return COLLABORATION_INVITE_CREDITS + Number(row?.total ?? 0);
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
  if (!gate.allowed) throw entitlementRequired("create_event", gate);
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
  if (!gate.allowed) throw entitlementRequired("grant_admin", gate);
}

/**
 * The PROFILE-level sibling of `assertGrantAdminAllows` (A-37).
 *
 * A-21 closed every EVENT-level path to admin authority. This is the other half:
 * an `admin` membership on a profile carries `members.manage` over the whole
 * account — a strictly larger grant than admin on a single event — so it is the
 * same paid-plan feature and it consumes a seat. Charged to the TARGET profile,
 * because that is the account gaining an administrator.
 *
 * Shaped like its event-level twin on purpose: promoting someone who is already
 * an admin re-grants nothing and so costs nothing.
 */
export async function assertProfileAdminGrantAllows(
  database: Database,
  grant: {
    profileId: string;
    nextRole: string | null | undefined;
    currentRole?: string | null;
  },
): Promise<void> {
  const { profileId, nextRole, currentRole = null } = grant;
  if (nextRole !== "admin" || currentRole === "admin") return;

  const gate = await canUseFeature(database, profileId, "grant_admin");
  if (!gate.allowed) throw entitlementRequired("grant_admin", gate);
}

/**
 * ── THE LEDGER'S TWO MOVEMENTS ───────────────────────────────────────────────
 *
 * Every change to a balance is an INSERT describing what happened, never an
 * UPDATE of a total. That is the whole reason `credit_ledger` is shaped the way
 * it is: a balance that is summed can be audited and re-derived, a balance that
 * is overwritten can only be believed.
 *
 * The two are paired by `reason`, which carries the invitation's id. Pairing is
 * what makes the refill safe: without it, answering an invitation that never cost
 * anything — one sent to somebody already on shoWMe — would mint a credit out of
 * nothing, and a performer could farm their allowance upward by inviting
 * colleagues.
 */

/** `reason` for the debit taken when an invitation leaves the platform. */
function spendReason(invitationId: string): string {
  return `invite:${invitationId}`;
}

/** `reason` for the credit returned when that invitation is answered. */
function refillReason(invitationId: string): string {
  return `invite-answered:${invitationId}`;
}

/**
 * Charge one credit for an invitation going to somebody who is NOT on shoWMe.
 *
 * Called inside the same transaction that writes the invitation, so an invitation
 * can never exist uncharged and a charge can never exist without its invitation.
 */
export async function spendCollaborationCredit(
  tx: Database | Transaction,
  input: { profileId: string; invitationId: string },
): Promise<void> {
  await tx.insert(schema.creditLedger).values({
    profileId: input.profileId,
    delta: -1,
    reason: spendReason(input.invitationId),
  });
}

/**
 * Return the credit an invitation cost, once its recipient ANSWERS — accepted or
 * declined alike.
 *
 * Daniel, 2026-09-01: "It's a cap based on response. So when they get a response
 * they get 1 back." This is a deliberate departure from Ran's spec, which reads
 * "+1 per accepted invite, declined/expired don't refill". Refunding a decline is
 * the better brake: what the cap is defending against is invitations fired into
 * the void, and somebody taking the time to say no is the opposite of that. An
 * EXPIRY still costs — silence is exactly the thing being metered.
 *
 * Idempotent and paired. It returns nothing unless the matching debit exists, and
 * refuses to pay twice for one invitation, so a re-answer, a retry or a second
 * code path cannot inflate the balance.
 */
export async function refillCollaborationCredit(
  tx: Database | Transaction,
  input: { profileId: string | null; invitationId: string },
): Promise<void> {
  if (!input.profileId) return;
  const rows = await tx
    .select({ reason: schema.creditLedger.reason })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.profileId, input.profileId),
        inArray(schema.creditLedger.reason, [
          spendReason(input.invitationId),
          refillReason(input.invitationId),
        ]),
      ),
    );
  const wasCharged = rows.some((row) => row.reason === spendReason(input.invitationId));
  const alreadyRefilled = rows.some((row) => row.reason === refillReason(input.invitationId));
  if (!wasCharged || alreadyRefilled) return;

  await tx.insert(schema.creditLedger).values({
    profileId: input.profileId,
    delta: 1,
    reason: refillReason(input.invitationId),
  });
}
