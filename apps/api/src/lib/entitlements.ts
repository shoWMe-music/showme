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
  | "send_external_invite"
  | "seat_available"
  | "create_template";

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
const PLAN_GATED_FEATURES: readonly Feature[] = [
  "create_event",
  "send_offer",
  "grant_admin",
  // A seat IS a thing we sell, so running out of them is genuinely an upgrade
  // prompt — unlike the invitation credits below.
  "seat_available",
  // "2 templates" on Basic and Performer, "Unlimited templates" on Pro — a
  // difference the Pro card is sold on, so running out is genuinely an upgrade.
  "create_template",
];
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

/**
 * Events on the free operator plan are UNLIMITED — because that is what we sell.
 *
 * The live pricing page's Basic card lists "**Unlimited events**" with a tick, and
 * has done throughout. The code enforced a cap of THREE confirmed-or-concluded
 * events per rolling year, so a free operator confirming their fourth booking met
 * a 403 upgrade prompt contradicting the page they signed up from.
 *
 * `null` rather than a big number: a limit nobody may reach is still a limit, and
 * it would eventually be discovered by whoever hosts more shows than we guessed.
 * PLAN.md:613 specifies that a cap EXISTS and never fixes its value; the pricing
 * page does, and the pricing page is the promise.
 *
 * Pro is sold on what the tagline actually says — budget planner, team
 * management, CRM, API access, unlimited templates, "for operators with high
 * event volume (60+ a year), intensive admin and/or teams of 3 or more" — not on
 * rationing the third booking of somebody's year.
 */
const FREE_OPERATOR_EVENT_LIMIT: number | null = null;
/** free_artist may send at most this many offers per calendar month. */
const FREE_ARTIST_OFFER_LIMIT = 50;
/**
 * "2 templates" — the free allowance on both Basic and Performer. Pro's card says
 * "Unlimited templates", which Ran's feedback #10 added deliberately, so the free
 * ceiling is the thing that makes that line mean anything.
 */
const FREE_TIER_TEMPLATE_LIMIT = 2;

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
      // Only free_operator is metered; every other tier hosts without limit —
      // and since the pricing page says "Unlimited events" on Basic too, the
      // limit is currently null and nobody is metered at all. The COUNT below is
      // kept because it is what a cap would use the day one is reintroduced, and
      // because `used` is worth reporting even when nothing is enforced.
      if (tier !== "free_operator" || FREE_OPERATOR_EVENT_LIMIT === null) {
        return { allowed: true };
      }
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

    case "create_template": {
      if (isPaidTier(tier)) return { allowed: true };
      const [row] = await db
        .select({ used: count() })
        .from(schema.templates)
        .where(eq(schema.templates.profileId, profileId));
      const used = row?.used ?? 0;
      const limit = FREE_TIER_TEMPLATE_LIMIT;
      return {
        allowed: used < limit,
        used,
        limit,
        reason: used < limit ? undefined : "Your plan includes two templates",
      };
    }

    case "seat_available": {
      // Reported as used/limit like the other metered features, so a screen can
      // say "2 of 2 seats used" instead of only discovering the ceiling by
      // hitting it. The per-grant decision is `assertSeatAvailableForRole`,
      // which also knows the role being granted; this is the standing snapshot.
      const [plan] = await db
        .select({ seats: schema.plans.seats })
        .from(schema.plans)
        .where(eq(schema.plans.profileId, profileId));
      const limit = seatAllowance(tier, plan?.seats);
      const used = await countConsumedSeats(db, profileId);
      return {
        allowed: used < limit,
        used,
        limit,
        reason: used < limit ? undefined : "Every administrator seat on this plan is taken",
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
 * ── SEATS ────────────────────────────────────────────────────────────────────
 *
 * WHICH ROLES COST ONE. A membership that can CHANGE the account costs a seat;
 * one that can only look does not. Daniel, 2026-09-01: *"Freemium gets one admin
 * seat the rest are all view roles (team/crew). Paid gets two account Admins
 * which means two admin/Editor roles, the rest are view only."*
 *
 * `editor` is in this list, and that is the whole point of the change. It was
 * ungated on every tier: `assertProfileAdminGrantAllows` returned early unless
 * the role was exactly `admin`, so a free account could hand out unlimited edit
 * access simply by picking the role one notch down. In Daniel's words, that
 * "cannibalizes" the seat somebody else is paying for.
 *
 * `owner` counts too — it is the account's own administrator, and
 * `POST /profiles` has always written `seat_consumed: true` for it. So a free
 * account's single seat is the owner's, which is exactly "freemium gets one
 * admin seat" read literally.
 */
export const SEAT_CONSUMING_ROLES = ["owner", "admin", "editor"] as const;

/** Does holding this role occupy one of the account's seats? */
export function roleConsumesSeat(role: string | null | undefined): boolean {
  return (SEAT_CONSUMING_ROLES as readonly string[]).includes(role ?? "");
}

/** The free tier's allowance: the owner, and nobody else who can change things. */
const FREE_TIER_SEATS = 1;
/** A paid plan buys one more administrator — two in total. */
const PAID_TIER_SEATS = 2;

/**
 * How many seats this account has.
 *
 * The tier decides it, but a STORED `plans.seats` larger than the tier default
 * wins — that is how a negotiated or enterprise allowance is expressed, and
 * reading the column the other way round would silently cancel one. A stored
 * value SMALLER than the default is ignored rather than obeyed: every row
 * predates this rule and carries the column default of 1, and honouring that
 * would hand every paid account a downgrade on deploy.
 */
export function seatAllowance(tier: PlanTier, storedSeats?: number | null): number {
  const base = isPaidTier(tier) ? PAID_TIER_SEATS : FREE_TIER_SEATS;
  return Math.max(base, storedSeats ?? 0);
}

/** Seats currently occupied — a COUNT, never a stored total, like every limit here. */
export async function countConsumedSeats(db: Database, profileId: string): Promise<number> {
  const [row] = await db
    .select({ used: count() })
    .from(schema.profileMembers)
    .where(
      and(
        eq(schema.profileMembers.profileId, profileId),
        eq(schema.profileMembers.status, "active"),
        inArray(schema.profileMembers.role, [...SEAT_CONSUMING_ROLES]),
      ),
    );
  return row?.used ?? 0;
}

/**
 * May this profile give somebody a role that can change the account?
 *
 * Replaces `assertProfileAdminGrantAllows`, which asked the wrong question. That
 * one gated `admin` on "is this a paid plan?" and let `editor` through on every
 * tier — so the paid seat was bypassed by choosing the role beneath it, and a
 * paid account could mint unlimited admins because nothing ever counted them.
 * `seat_consumed` was written in three places and read in none.
 *
 * Promoting somebody who already holds a seat-consuming role costs nothing: they
 * are already occupying the seat, and admin → editor is not a new grant. Only a
 * move from a view-only role into a seat-consuming one is charged.
 *
 * A refusal here IS an upgrade prompt — unlike the invitation-credit gate, a
 * seat is a thing we sell, and "buy a plan to add another administrator" is a
 * true and useful sentence.
 */
export async function assertSeatAvailableForRole(
  db: Database,
  grant: {
    profileId: string;
    nextRole: string | null | undefined;
    currentRole?: string | null;
  },
): Promise<void> {
  const { profileId, nextRole, currentRole = null } = grant;
  if (!roleConsumesSeat(nextRole)) return;
  if (roleConsumesSeat(currentRole)) return;

  const tier = await getPlanTier(db, profileId);
  const [plan] = await db
    .select({ seats: schema.plans.seats })
    .from(schema.plans)
    .where(eq(schema.plans.profileId, profileId));

  const limit = seatAllowance(tier, plan?.seats);
  const used = await countConsumedSeats(db, profileId);
  if (used < limit) return;

  throw entitlementRequired("seat_available", {
    allowed: false,
    used,
    limit,
    reason:
      limit === FREE_TIER_SEATS
        ? "Your plan includes one administrator. Everyone else can be added as a viewer or crew."
        : `Your plan includes ${limit} administrators. Everyone else can be added as a viewer or crew.`,
  });
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

/**
 * ONE PROFILE PER ACCOUNT, on a free plan — the Basic card's line, and the rule
 * PLAN.md left room for.
 *
 * PLAN.md:564 removed the old app's 16-profile limit as a JWT-claim-size artifact
 * and is explicit that "any real cap would be a deliberate plan/entitlement rule,
 * never a mechanism constraint". This is that rule arriving from the pricing page
 * rather than from the token format, so the two agree rather than conflict.
 *
 * THE ACCOUNT IS THE USER, not the profile — which is the whole difficulty, since
 * a plan is stored per PROFILE. Somebody creating their second profile is asked:
 * does any profile you already own sit on a paid plan? If so the account is paid
 * and may hold more; if every one is free, this is a free account and it already
 * has its profile.
 *
 * Ownership is `profiles.owner_user_id` rather than membership: being invited
 * onto somebody else's venue as a viewer is not "having a profile", and counting
 * it would make an account's own allowance depend on who had added them to what.
 */
export async function assertProfileAllowanceForUser(db: Database, userId: string): Promise<void> {
  const owned = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.ownerUserId, userId));
  if (owned.length === 0) return;

  for (const profile of owned) {
    const tier = await getPlanTier(db, profile.id);
    if (isPaidTier(tier)) return;
  }

  // Built directly rather than through `entitlementRequired`, because this gate
  // is keyed by USER and `Feature` is the set of things `canUseFeature` can
  // answer about a PROFILE. Adding it there would need a switch case that lies.
  // The CODE is the same, so the UI's one upgrade component still answers it.
  throw new HttpError(403, "Your plan includes one profile", ENTITLEMENT_REQUIRED_CODE);
}
