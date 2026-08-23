import { badRequest, conflict } from "../errors";

/**
 * Pure state-machine + region helpers for agent↔performer representations
 * (decisions.md #14). No I/O, no framework — the route layer loads rows, calls
 * these, and persists the result. Kept framework-agnostic so the rules are unit
 * tested in isolation from Fastify and Postgres.
 */

/** Which side of a representation an actor is: the agent or the performer. */
export type RepresentationParty = "agent" | "performer";

/** A territory: an explicit list of ISO country codes, or "everywhere". */
export interface RegionScope {
  region: string[] | null;
  isWorldwide: boolean;
}

/** An existing active territory, plus the agent who holds it (named in conflicts). */
export interface HeldRegionScope extends RegionScope {
  agentProfileId: string;
}

/** The two-party handshake state (plus who made the current offer). */
export interface ConfirmFlags {
  proposedBy: RepresentationParty;
  confirmedByAgent: boolean;
  confirmedByPerformer: boolean;
}

// ─── Account kinds — who may stand on each side (audit A-16) ─────────────────

/**
 * The two sides of a representation are kind-fixed, and this is not a formality:
 * story.md defines `team_and_crew` *by contrast with* the agent — crew are "paid a
 * fixed fee — contrast the agent, who takes a percentage of someone else's
 * income". A representation IS that percentage. So an agent→crew or agent→operator
 * "representation" is not a stricter case of the same thing, it is a different
 * product we deliberately do not serve (story.md, "Agent — represents the talent").
 *
 * The kinds are immutable once a profile exists, so this can only fail at propose —
 * but it is asserted again at accept, because accept is where the agreement becomes
 * binding and a rule that gates a binding act belongs at the binding act.
 */
export function assertRepresentationPartyKinds(
  agentKind: string | null | undefined,
  performerKind: string | null | undefined,
): void {
  if (agentKind !== "agent") {
    throw badRequest(
      `The agent side of a representation must be a profile of kind "agent" (got "${agentKind ?? "none"}") — a representation is a commission on a performer's live income, which is the agent kind's whole definition`,
    );
  }
  if (performerKind !== "performer") {
    throw badRequest(
      `The performer side of a representation must be a profile of kind "performer" (got "${performerKind ?? "none"}") — crew are paid a fixed fee and operators book the show; neither has live income for an agent to take a percentage of`,
    );
  }
}

// ─── Commission terms — the closed vocabulary (audit A-18) ───────────────────

/**
 * What the commission is a percentage OF.
 *
 * Exactly one value today, and that is a statement about the engine, not
 * laziness: `syncCommissionSettlements` + `settleRepresentation` commission the
 * performer's **whole event entitlement** — everything their deal lines pay them,
 * which is precisely "live deal income" (guarantee, door/ticket split, escalators,
 * bonuses). There is no code anywhere that can compute a NARROWER basis, so
 * offering the user a choice would be offering a setting that changes nothing —
 * the failure mode A-18 found, where `"merchandise_and_publishing"` was stored,
 * displayed as the agreed basis, and then quietly commissioned everything anyway.
 *
 * Merch and publishing are not a missing feature here: story.md draws the agent's
 * boundary at live bookings — "never on merch or non-live revenue" (story.md:69,
 * decisions.md #14) — so they are excluded by DEFINITION and will never join this
 * list. Split bases (guarantee-only, door-only) *could* join it, the day the
 * engine can attribute an entitlement to a deal component.
 */
export const COMMISSIONABLE_BASES = ["deal_income"] as const;

export type CommissionableBasis = (typeof COMMISSIONABLE_BASES)[number];

/** The only basis the commission engine can compute — also the default. */
export const DEFAULT_COMMISSIONABLE_BASIS: CommissionableBasis = "deal_income";

export function isCommissionableBasis(value: string): value is CommissionableBasis {
  return (COMMISSIONABLE_BASES as readonly string[]).includes(value);
}

/**
 * Commission bounds, in basis points (per decisions.md #7 every rate is bp).
 * Above zero, because a 0% "commission" is not an agreement to take a percentage;
 * at most 50%, because past half the performer's income the agent is the principal
 * and the performer the service — that is not representation, and story.md's agent
 * is compensated for closing live deals, not for owning them. (A-18 accepted 99%.)
 */
export const MINIMUM_COMMISSION_BASIS_POINTS = 1;
export const MAXIMUM_COMMISSION_BASIS_POINTS = 5000;

/** The human-readable bound, reused by the Zod message and by the handler. */
export const COMMISSION_RATE_MESSAGE = `Commission must be between ${MINIMUM_COMMISSION_BASIS_POINTS} and ${MAXIMUM_COMMISSION_BASIS_POINTS} basis points (above 0%, at most 50.00%) — a majority commission is not representation`;

export function isCommissionRateInRange(basisPoints: number): boolean {
  return (
    Number.isInteger(basisPoints) &&
    basisPoints >= MINIMUM_COMMISSION_BASIS_POINTS &&
    basisPoints <= MAXIMUM_COMMISSION_BASIS_POINTS
  );
}

/**
 * A territory must say exactly one thing. `isWorldwide` with a country list is two
 * contradictory territories on one row — and since `regionsOverlap` short-circuits
 * on `isWorldwide`, the list would be dead data that still *reads* as the scope.
 * Checked after merging a counter's partial edits onto the existing terms, because
 * a counter can flip either half.
 */
export function assertCoherentTerritory(scope: RegionScope): void {
  const region = scope.region ?? [];
  if (scope.isWorldwide && region.length > 0) {
    throw badRequest(
      "A worldwide representation cannot also list countries — clear `region` or set `isWorldwide` to false",
    );
  }
  if (!scope.isWorldwide && region.length === 0) {
    throw badRequest(
      "A representation needs a territory — list at least one ISO 3166-1 alpha-2 country code, or set `isWorldwide`",
    );
  }
}

// ─── Liveness — the one answer to "is this representation live right now?" ────

/**
 * Re-exported, not redefined. The predicates moved to `@showme/shared` the moment
 * the capability engine needed them too (`packages/auth` cannot import from
 * `apps/api`), and a second copy of "is the notice period over?" is precisely the
 * drift this module exists to prevent. Everything in this file's call sites keeps
 * importing them from here.
 */
export {
  type RepresentationLifecycle,
  isPendingTermination,
  isRepresentationActiveAt,
  terminationTakesEffectNow,
} from "@showme/shared";

// ─── The disjoint-region invariant ───────────────────────────────────────────

/**
 * Do two territories intersect? Worldwide overlaps everything; otherwise it's a
 * non-empty intersection of country codes. The basis for "one active agent per
 * performer per region" — active regions must be disjoint.
 */
export function regionsOverlap(a: RegionScope, b: RegionScope): boolean {
  if (a.isWorldwide || b.isWorldwide) return true;
  const codes = new Set(a.region ?? []);
  return (b.region ?? []).some((code) => codes.has(code));
}

/** The countries two territories share, named in the conflict so the user can fix it. */
export function overlappingRegions(a: RegionScope, b: RegionScope): string[] {
  if (a.isWorldwide) return b.isWorldwide ? [] : [...(b.region ?? [])];
  if (b.isWorldwide) return [...(a.region ?? [])];
  const codes = new Set(a.region ?? []);
  return (b.region ?? []).filter((code) => codes.has(code));
}

/** "SE, NO" / "worldwide" — how an overlap is described back to the caller. */
function describeOverlap(existing: RegionScope, proposed: RegionScope): string {
  const shared = overlappingRegions(existing, proposed);
  return shared.length > 0 ? shared.join(", ") : "worldwide";
}

/**
 * Guard the disjoint-region invariant: a representation may not overlap any of the
 * performer's currently ACTIVE representations. Throws a 409 conflict on the first
 * overlap, naming the region(s) and the agent already holding them.
 *
 * NOTE — a representation working out a notice period is still ACTIVE here, by
 * design: the outgoing agent is still contractually working the territory, so the
 * successor cannot be activated over it until the notice expires. Two agents on one
 * region at once is exactly what this invariant exists to prevent (audit A-17).
 */
export function assertDisjoint(
  existingActive: readonly HeldRegionScope[],
  proposed: RegionScope,
): void {
  for (const existing of existingActive) {
    if (regionsOverlap(existing, proposed)) {
      throw conflict(
        `Region ${describeOverlap(existing, proposed)} is already covered by an active representation with agent ${existing.agentProfileId} — one active agent per performer per region`,
      );
    }
  }
}

/**
 * Apply a counter-offer to the handshake: the caller (`proposedBy`) becomes the
 * current proposer and their own side is confirmed; the counterparty's earlier
 * confirmation is cleared, because the new terms must be re-confirmed. Returns a
 * copy of `representation` with the re-stamped flags (terms are edited by the
 * caller separately).
 */
export function applyCounter<T extends ConfirmFlags>(
  representation: T,
  proposedBy: RepresentationParty,
): T {
  return {
    ...representation,
    proposedBy,
    confirmedByAgent: proposedBy === "agent",
    confirmedByPerformer: proposedBy === "performer",
  };
}
