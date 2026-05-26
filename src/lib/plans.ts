import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

import { getFirestoreDb } from "@/integrations/firebase/app";

/**
 * Plan types — one per (profile type, free/paid) combination.
 * Stored on `plans/{profileId}.type`. Source of truth for every gated surface.
 */
export type PlanType =
  | "free_operator"
  | "operator_pro"
  | "free_artist"
  | "artist_pro";

export const PLAN_LABELS: Record<PlanType, string> = {
  free_operator: "Free Operator",
  operator_pro: "Operator Pro",
  free_artist: "Free Artist",
  artist_pro: "Artist Pro",
};

export type PlanStatus = "active" | "cancelled";

export type PlanSource = "manual" | "mollie";

export interface PlanHistoryEntry {
  from: PlanType | null;
  to: PlanType;
  /** ISO timestamp, written server-side. */
  at: string;
  /** UID of the actor (admin uid for source: 'manual'). */
  by: string;
  reason?: string;
}

export interface ProfilePlan {
  profileId: string;
  type: PlanType;
  source: PlanSource;
  status: PlanStatus;
  /** ISO timestamp. */
  assignedAt: string;
  /** UID of the actor. */
  assignedBy: string;
  /** ISO timestamp. Paid tiers only. */
  renewalAt?: string;
  /** operator_pro only — defaults to 2. */
  seats?: number;
  cancelReason?: string;
  history: PlanHistoryEntry[];
  /** Maintained server-side for free_operator. Undefined on paid/artist plans. */
  eventCapCount?: number;
  /** Mirror of eventCapCount >= 66, kept in sync by the trigger. */
  eventCapBlocked?: boolean;
}

const OPERATOR_PLAN_TYPES: ReadonlySet<PlanType> = new Set<PlanType>([
  "free_operator",
  "operator_pro",
]);

const ARTIST_PLAN_TYPES: ReadonlySet<PlanType> = new Set<PlanType>([
  "free_artist",
  "artist_pro",
]);

const PAID_PLAN_TYPES: ReadonlySet<PlanType> = new Set<PlanType>([
  "operator_pro",
  "artist_pro",
]);

export function isPaidPlan(type: PlanType): boolean {
  return PAID_PLAN_TYPES.has(type);
}

export function isOperatorPlan(type: PlanType): boolean {
  return OPERATOR_PLAN_TYPES.has(type);
}

export function isArtistPlan(type: PlanType): boolean {
  return ARTIST_PLAN_TYPES.has(type);
}

/**
 * Map a profile's role/type to the matching Free plan type. Used by the
 * backfill script and by the on-first-create plan writer.
 *
 * Mirrors the rule-side classification (venue/promoter/organizer/festival
 * → operator; performer → artist).
 */
export function defaultPlanTypeForProfileRole(
  role: string | undefined | null,
): PlanType {
  const r = (role ?? "").toLowerCase();
  if (r === "performer" || r === "artist") return "free_artist";
  return "free_operator";
}

/**
 * Subscribe to a profile's plan. Returns the plan on every snapshot.
 * `null` while loading; `undefined` if the plan doc doesn't exist (legacy
 * profile before backfill, or a freshly-created profile awaiting its first
 * write).
 *
 * Direct doc subscription is the design intent — we deliberately do NOT
 * carry plan info in a custom claim, so a plan change (downgrade in
 * particular) takes effect immediately for every member, with no JWT
 * staleness window.
 */
export function useProfilePlan(profileId: string | null | undefined): {
  plan: ProfilePlan | null | undefined;
  loading: boolean;
} {
  const [plan, setPlan] = useState<ProfilePlan | null | undefined>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!profileId) {
      setPlan(undefined);
      setLoading(false);
      return;
    }

    setLoading(true);

    let db;
    try {
      db = getFirestoreDb();
    } catch {
      setLoading(false);
      return;
    }

    const ref = doc(db, "plans", profileId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setPlan(undefined);
        } else {
          setPlan(snap.data() as ProfilePlan);
        }
        setLoading(false);
      },
      () => {
        setPlan(undefined);
        setLoading(false);
      },
    );

    return () => {
      unsub();
    };
  }, [profileId]);

  return { plan, loading };
}

/**
 * Synchronous predicate used by UI to hide / lock a feature when the active
 * profile is on a plan not in `allowed`. Treats an unknown / not-yet-loaded
 * plan as "free of the matching type" — locked, never accidentally open.
 *
 * For security-sensitive checks, always re-verify server-side in a callable
 * or in Firestore rules. This is convenience-only UI gating.
 */
export function planAllows(
  plan: ProfilePlan | null | undefined,
  allowed: ReadonlyArray<PlanType>,
): boolean {
  if (!plan) return false;
  return allowed.includes(plan.type);
}

/**
 * Subscribe to plans for many profile IDs at once. Used by surfaces that are
 * account-scope rather than profile-scope (the dashboard, the team page),
 * where the gate is "does the user have any paid profile" rather than "is
 * THIS profile paid".
 *
 * Returns a map keyed by profileId. `undefined` for an id means no plan doc
 * exists yet (treat as Free of the matching type).
 */
export function useProfilePlans(profileIds: ReadonlyArray<string>): {
  plans: Record<string, ProfilePlan | undefined>;
  loading: boolean;
} {
  const [plans, setPlans] = useState<Record<string, ProfilePlan | undefined>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // Stable key so the effect re-runs only when the set actually changes —
  // a fresh array literal on every render would otherwise tear down + rebuild
  // the listeners on each parent re-render.
  const key = useMemo(() => [...profileIds].sort().join(","), [profileIds]);

  useEffect(() => {
    if (profileIds.length === 0) {
      setPlans({});
      setLoading(false);
      return;
    }

    setLoading(true);

    let db;
    try {
      db = getFirestoreDb();
    } catch {
      setLoading(false);
      return;
    }

    const resolved = new Set<string>();
    const unsubs: Array<() => void> = [];

    for (const pid of profileIds) {
      if (!pid) continue;
      const ref = doc(db, "plans", pid);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          setPlans((prev) => ({
            ...prev,
            [pid]: snap.exists() ? (snap.data() as ProfilePlan) : undefined,
          }));
          resolved.add(pid);
          if (resolved.size >= profileIds.length) setLoading(false);
        },
        () => {
          setPlans((prev) => ({ ...prev, [pid]: undefined }));
          resolved.add(pid);
          if (resolved.size >= profileIds.length) setLoading(false);
        },
      );
      unsubs.push(unsub);
    }

    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { plans, loading };
}

/**
 * Returns whether any of the user's profiles is currently on a Pro plan.
 * Used to gate account-scope surfaces (dashboard analytics, team email).
 *
 * Conservative defaults: while plans are still loading, returns `false` so
 * the gated surface starts hidden and reveals once we know the answer —
 * better than flashing the unlocked state to a Free user.
 */
export function useAccountHasPaidPlan(profileIds: ReadonlyArray<string>): {
  hasPaid: boolean;
  loading: boolean;
} {
  const { plans, loading } = useProfilePlans(profileIds);
  const hasPaid = Object.values(plans).some(
    (p) => !!p && isPaidPlan(p.type),
  );
  return { hasPaid, loading };
}
