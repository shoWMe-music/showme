import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, count, countDistinct, eq, gte, inArray, sql } from "drizzle-orm";

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
            inArray(schema.events.status, ["confirmed", "concluded"]),
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
