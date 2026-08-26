import { majorToMinor } from "./money";

/**
 * The DEAL vocabulary and the draft → request translation, as plain TS.
 *
 * A deal is a **party-scoped agreement between 1..N parties** (PLAN.md "Deals
 * model") — not "the performer's fee". Everything here is therefore written in
 * terms of *lines*: a line is one participant's role in the agreement, and the
 * money math (which line is entitled to what) is the settlement engine's, never a
 * component's. This module exists so the composing screen holds no arithmetic and
 * no rule: it collects what the parties agreed, and this decides whether that is
 * a thing the engine can actually settle.
 *
 * Every refusal below mirrors a rule the API or the engine already enforces. The
 * point is not to re-authorize anything — the server is the authority — but to
 * refuse locally the shapes that would come back as an avoidable 400, or worse,
 * be accepted and then quietly settle as nothing.
 */

/** What kind of agreement this is (the DB `deal_type` enum). */
export type DealType = "performance" | "rental" | "fee" | "split";

/** The settlement math the deal uses (the DB `deal_structure` enum). */
export type DealStructure = "guarantee" | "door_split" | "guarantee_vs_door" | "rental";

/** When the money moves (the DB `payment_timing` enum). */
export type PaymentTiming = "before_event" | "at_settlement" | "due_date";

/**
 * A party's role on the deal.
 *
 * `commission` is deliberately absent, and it is the one omission worth naming.
 * The DB enum still has it, but for a **private agent representation** decisions
 * #14 moved commission out of the event deal entirely (it is a separate
 * representation-scoped settlement, so the event's `Σ net = 0` has no hidden
 * term), and the only remaining reading — a *disclosed, off-the-top* commission —
 * is not wired: `reconcileEvent` never populates `SettlementDeal.commissions`, so
 * a line written with that role is read by nobody and pays nothing. Offering it
 * would be offering a term the engine silently drops.
 */
export type DealPartyRole = "payer" | "payee" | "split_member" | "observer";

export interface DealTypeOption {
  value: DealType;
  label: string;
  description: string;
}

/**
 * Kind-agnostic on purpose: the same four cover an act, a room, a crew hire and a
 * shared pot, because a deal does not know what kind of account is on the other
 * end of it (story.md: roles are per-event, kinds are per-account).
 */
export const DEAL_TYPE_OPTIONS: DealTypeOption[] = [
  {
    value: "performance",
    label: "Performance",
    description: "Booking an act to play.",
  },
  {
    value: "rental",
    label: "Rental",
    description: "Renting the room, or part of it, at arm's length.",
  },
  {
    value: "fee",
    label: "Fee for service",
    description: "Crew or a service, paid a flat amount for the work.",
  },
  {
    value: "split",
    label: "Shared split",
    description: "A pot that several parties divide between them.",
  },
];

export interface DealStructureOption {
  /** `null` = a paper-only agreement: recorded, signed, never computed. */
  value: DealStructure | null;
  label: string;
  description: string;
}

/**
 * What the settlement engine will actually do with this deal. These four are the
 * whole of `dealEntitlement()` — there is no fifth, and a shape not covered here
 * is a paper-only agreement rather than a new structure (decisions #16.2: free
 * text broke the engine, which can only reconcile a shape it recognises).
 */
export const DEAL_STRUCTURE_OPTIONS: DealStructureOption[] = [
  {
    value: "guarantee",
    label: "Guarantee",
    description: "A fixed amount, whatever the night does.",
  },
  {
    value: "door_split",
    label: "Door split",
    description: "A share of the pool — revenue less the costs paid to outside suppliers.",
  },
  {
    value: "guarantee_vs_door",
    label: "Guarantee vs door",
    description: "Whichever of the two is larger. The guarantee is the floor.",
  },
  {
    value: "rental",
    label: "Rental fee",
    description: "A fixed amount for the room, settled like a guarantee.",
  },
  {
    value: null,
    label: "Paper agreement only",
    description: "Terms both sides sign, with no figure for the settlement to compute.",
  },
];

export interface PaymentTimingOption {
  value: PaymentTiming;
  label: string;
  description: string;
}

export const PAYMENT_TIMING_OPTIONS: PaymentTimingOption[] = [
  {
    value: "at_settlement",
    label: "At settlement",
    description: "Reconciled with everything else after the show.",
  },
  {
    value: "before_event",
    label: "Before the event",
    description: "Paid up front, then accounted for in the settlement.",
  },
  {
    value: "due_date",
    label: "On a due date",
    description: "On the date the invoice states.",
  },
];

export interface DealPartyRoleOption {
  value: DealPartyRole;
  label: string;
  description: string;
}

export const DEAL_PARTY_ROLE_OPTIONS: DealPartyRoleOption[] = [
  {
    value: "payer",
    label: "Pays",
    description: "Funds the agreement, and sees the whole of it.",
  },
  {
    value: "payee",
    label: "Is paid",
    description: "Entitled to what the deal pays out.",
  },
  {
    value: "split_member",
    label: "Takes a share",
    description: "One of several who divide the payout, by a stated percentage.",
  },
  {
    value: "observer",
    label: "Observes",
    description: "Can read the agreement. Signs nothing, settles nothing.",
  },
];

/** The roles that are ENTITLED to money — the ones the engine pays. */
const ENTITLED_ROLES: readonly DealPartyRole[] = ["payee", "split_member"];

/** One party's line, as the composing screen holds it (strings, as typed). */
export interface DealPartyDraft {
  /** Stable local key for the row. Never sent. */
  key: string;
  /** An `event_participants` id, or "" while unchosen. */
  participantId: string;
  roleInDeal: DealPartyRole;
  /** Percent of the payout as typed ("40", "33.34"). Only read for `split_member`. */
  sharePercent: string;
}

/** A deal as the composing screen holds it — every amount in MAJOR units, as typed. */
export interface DealDraft {
  name: string;
  type: DealType;
  structure: DealStructure | null;
  currency: string;
  /** Major units, as typed. Read for guarantee / guarantee_vs_door / rental. */
  guaranteeAmount: string;
  /** Percent of the pool, as typed. Read for door_split / guarantee_vs_door. */
  splitPercent: string;
  /** The portion paid before the event, major units as typed (decisions #1). */
  advanceAmount: string;
  paymentTiming: PaymentTiming;
  parties: DealPartyDraft[];
}

/** One party line in the shape `POST /events/:id/deals` accepts. */
export interface DealPartyPayload {
  participantId: string;
  roleInDeal: DealPartyRole;
  share?: { splitBasisPoints: number };
}

/** The request body for `POST /events/:id/deals` (money in minor units, as strings). */
export interface CreateDealPayload {
  type: DealType;
  structure?: DealStructure;
  name: string;
  currency: string;
  guaranteeAmount?: string;
  advanceAmount?: string;
  splitBasisPoints?: number;
  paymentTiming: PaymentTiming;
  parties: DealPartyPayload[];
}

/** Whether the structure settles against a fixed amount. */
export function structureNeedsGuarantee(structure: DealStructure | null): boolean {
  return structure === "guarantee" || structure === "rental" || structure === "guarantee_vs_door";
}

/** Whether the structure settles against a share of the pool. */
export function structureNeedsSplit(structure: DealStructure | null): boolean {
  return structure === "door_split" || structure === "guarantee_vs_door";
}

/** A typed percent ("40", "33.34") as basis points (4000, 3334). Null if unreadable. */
export function percentToBasisPoints(percent: string): number | null {
  const text = percent.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Basis points back to a percent string for display ("4000" → "40"). */
export function basisPointsToPercent(basisPoints: number): string {
  return String(Math.round(basisPoints) / 100);
}

/** A typed major amount as minor units, or null if it is blank or unreadable. */
function amountToMinor(amount: string, currency: string): bigint | null {
  const text = amount.trim();
  if (text === "") return null;
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
  return majorToMinor(text.replace(",", "."), currency);
}

/** An empty party line, ready to be filled in. */
export function emptyDealParty(key: string, roleInDeal: DealPartyRole = "payee"): DealPartyDraft {
  return { key, participantId: "", roleInDeal, sharePercent: "" };
}

/**
 * A blank deal. Two lines from the start, because the smallest real agreement has
 * two ends — and starting at one invites a screen that assumes exactly one
 * performer, which is the shape this model deliberately does not have.
 */
export function emptyDealDraft(currency: string): DealDraft {
  return {
    name: "",
    type: "performance",
    structure: "guarantee",
    currency,
    guaranteeAmount: "",
    splitPercent: "",
    advanceAmount: "",
    paymentTiming: "at_settlement",
    parties: [emptyDealParty("party-1", "payer"), emptyDealParty("party-2", "payee")],
  };
}

/**
 * Everything wrong with the draft, in the words the person composing it needs.
 *
 * Empty = ready to send. Each rule below is one the server or the engine already
 * has; stating them here is what turns "400 Bad Request" into a sentence.
 */
export function dealDraftProblems(
  draft: DealDraft,
  /** Participant ids on this event whose role is `agent` (decisions #14). */
  agentParticipantIds: readonly string[] = [],
): string[] {
  const problems: string[] = [];

  if (draft.name.trim() === "") {
    problems.push("Give the agreement a name — it is how both sides refer to it.");
  }

  const chosen = draft.parties.filter((party) => party.participantId !== "");
  if (chosen.length === 0) {
    problems.push("An agreement needs at least one party.");
  }
  if (chosen.length !== new Set(chosen.map((party) => party.participantId)).size) {
    problems.push("Each party can hold only one line on the same agreement.");
  }
  for (const party of chosen) {
    if (agentParticipantIds.includes(party.participantId) && party.roleInDeal !== "observer") {
      // decisions #14: the agent acts FOR the performer, whose own line stays the
      // entitled one. It is never a separate entitled party.
      problems.push(
        "A booking agent is never an entitled party — it acts for the performer it represents, whose own line is the entitled one. Set the agent to Observes.",
      );
    }
  }

  const entitled = chosen.filter((party) => ENTITLED_ROLES.includes(party.roleInDeal));
  if (draft.structure !== null && entitled.length === 0) {
    problems.push(
      "Nobody on this agreement is paid by it. Give a party the Is paid or Takes a share role, or record it as a paper agreement.",
    );
  }

  if (structureNeedsGuarantee(draft.structure)) {
    const guarantee = amountToMinor(draft.guaranteeAmount, draft.currency);
    if (guarantee == null || guarantee <= 0n) {
      problems.push("This structure settles against a fixed amount, so it needs one.");
    }
  }
  if (structureNeedsSplit(draft.structure)) {
    const split = percentToBasisPoints(draft.splitPercent);
    if (split == null || split <= 0 || split > 10000) {
      problems.push("A door split needs a percentage of the pool between 0 and 100.");
    }
  }

  const advance = amountToMinor(draft.advanceAmount, draft.currency);
  if (draft.advanceAmount.trim() !== "" && advance == null) {
    problems.push("The advance is not a readable amount.");
  }
  if (advance != null && advance < 0n) {
    problems.push("An advance cannot be negative.");
  }
  if (advance != null && structureNeedsGuarantee(draft.structure)) {
    const guarantee = amountToMinor(draft.guaranteeAmount, draft.currency);
    if (guarantee != null && advance > guarantee) {
      problems.push("The advance is part of the guarantee, so it cannot exceed it.");
    }
  }

  // Split weights. The engine allocates a deal's payout across its entitled lines
  // by their stated weights, and defaults an unstated one to 1 — so ONE line
  // stating 60% beside another stating nothing does not settle 60/40, it settles
  // 6000/1. Either every line states its share or none does (PLAN.md:161: split
  // members divide 100% of the pool).
  if (entitled.length > 1) {
    const stated = entitled.map((party) => percentToBasisPoints(party.sharePercent));
    if (stated.some((value) => value == null)) {
      problems.push(
        "When more than one party shares the payout, every one of them has to state its share — an unstated share is not an equal share.",
      );
    } else {
      const total = stated.reduce<number>((running, value) => running + (value ?? 0), 0);
      if (total !== 10000) {
        problems.push(
          `The shares add up to ${(total / 100).toFixed(2)}%. They have to divide the payout exactly — 100%.`,
        );
      }
    }
  }

  return problems;
}

/**
 * Translate a valid draft into the request body. Money crosses as a minor-unit
 * STRING and percentages as basis points (money.md) — a JS number never carries
 * either.
 */
export function createDealPayload(draft: DealDraft): CreateDealPayload {
  const guarantee = structureNeedsGuarantee(draft.structure)
    ? amountToMinor(draft.guaranteeAmount, draft.currency)
    : null;
  const advance = amountToMinor(draft.advanceAmount, draft.currency);
  const split = structureNeedsSplit(draft.structure)
    ? percentToBasisPoints(draft.splitPercent)
    : null;

  const chosen = draft.parties.filter((party) => party.participantId !== "");
  const entitledCount = chosen.filter((party) => ENTITLED_ROLES.includes(party.roleInDeal)).length;

  return {
    type: draft.type,
    ...(draft.structure ? { structure: draft.structure } : {}),
    name: draft.name.trim(),
    currency: draft.currency,
    ...(guarantee != null ? { guaranteeAmount: guarantee.toString() } : {}),
    ...(advance != null ? { advanceAmount: advance.toString() } : {}),
    ...(split != null ? { splitBasisPoints: split } : {}),
    paymentTiming: draft.paymentTiming,
    parties: chosen.map((party) => {
      const share =
        entitledCount > 1 && ENTITLED_ROLES.includes(party.roleInDeal)
          ? percentToBasisPoints(party.sharePercent)
          : null;
      return {
        participantId: party.participantId,
        roleInDeal: party.roleInDeal,
        ...(share != null ? { share: { splitBasisPoints: share } } : {}),
      };
    }),
  };
}

/** The stated share on a serialized `deal_party.share`, or null if it states none. */
export function shareBasisPointsOf(share: unknown): number | null {
  if (share == null || typeof share !== "object") return null;
  const value = (share as { splitBasisPoints?: unknown }).splitBasisPoints;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
