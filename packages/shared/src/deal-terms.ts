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

/**
 * A DEAL KIND — one entry in the single "Kind of deal" menu.
 *
 * There used to be two menus: "Kind of deal" (the `deal_type` enum) and "How it
 * settles" (the `deal_structure` enum). Splitting one idea in two is what the
 * product owner's review caught: *"kind of deal menu doesn't show the deals
 * possible: Door Split vs Guarantee, Guarantee, Door split, rental. And then all
 * extra ones like: freelancing employee, service, other (manual)."* Every name in
 * that list is a settlement SHAPE or a re-labelling of one — nobody thinks of the
 * relationship and the math as two questions, and the Create-Event wizard already
 * asked only one.
 *
 * So the menu is the shape, and the economic relationship (`deals.type`) is
 * DERIVED from it — see `dealTypeForKind`. `type` is a classification, never math:
 * the settlement engine reads `structure` and never `type` (grep it), so deriving
 * costs nothing and asking twice cost a confused operator every time.
 *
 * `service_fee` is the one kind that is not a structure of its own. A freelancer
 * or a supplier paid a flat amount settles EXACTLY as a guarantee; what differs is
 * the relationship, which is `deals.type = 'fee'`. Ran named "freelancing
 * employee" and "service" separately — the model has one word for both, so the
 * menu has one entry for both rather than a distinction the database cannot keep.
 */
export type DealKind = DealStructure | "service_fee" | "paper_only";

export interface DealKindOption {
  value: DealKind;
  label: string;
  description: string;
  /** The settlement math this kind runs. `null` = nothing is computed. */
  structure: DealStructure | null;
  /** The economic relationship it records, before the split refinement below. */
  type: DealType;
}

/**
 * The whole menu. The first four are the whole of `dealEntitlement()` — there is
 * no fifth structure, and a shape not covered here is recorded manually rather
 * than invented as a new one (decisions #16.2: free text broke the engine, which
 * can only reconcile a shape it recognises).
 */
export const DEAL_KIND_OPTIONS: DealKindOption[] = [
  {
    value: "guarantee",
    label: "Guarantee",
    description: "A fixed amount, whatever the night does.",
    structure: "guarantee",
    type: "performance",
  },
  {
    value: "door_split",
    label: "Door split",
    description: "A share of the pool — revenue less the costs paid to outside suppliers.",
    structure: "door_split",
    type: "performance",
  },
  {
    value: "guarantee_vs_door",
    label: "Guarantee vs door",
    description: "Whichever of the two is larger. The guarantee is the floor.",
    structure: "guarantee_vs_door",
    type: "performance",
  },
  {
    value: "rental",
    label: "Rental fee",
    description: "A fixed amount for the room, settled off the top before any split.",
    structure: "rental",
    type: "rental",
  },
  {
    value: "service_fee",
    label: "Fee for a service",
    description:
      "A freelancer, crew or a supplier paid a flat amount for the work. Settles like a guarantee.",
    structure: "guarantee",
    type: "fee",
  },
  {
    value: "paper_only",
    label: "Other — agreed manually",
    description:
      "shoWMe will not compute this one. Write the terms down, both sides sign them, and the parties settle it between themselves — no figure from it reaches the settlement.",
    structure: null,
    type: "performance",
  },
];

/** The settlement math a kind runs — `null` for the manually-agreed one. */
export function structureForKind(kind: DealKind): DealStructure | null {
  return DEAL_KIND_OPTIONS.find((option) => option.value === kind)?.structure ?? null;
}

/**
 * The `deals.type` a kind records — the economic RELATIONSHIP, derived so the
 * person composing is asked once.
 *
 * One rule: the kind names the relationship, except that a payout divided between
 * more than one entitled party IS the shared-split relationship whatever shape it
 * settles by ("A pot that several parties divide between them"). A rental and a
 * service fee keep their own word — two crew on one invoice is still a fee.
 *
 * ON THE MANUALLY-AGREED KIND: it states no shape, so it states no relationship
 * either, and `deals.type` is NOT NULL. It records `performance` — the enum's
 * neutral member and the composer's own default — which is a LABEL on a deal
 * nothing computes, not a claim about the money. Every other kind states its type
 * outright, so this is the only place the column is a placeholder.
 */
export function dealTypeForKind(kind: DealKind, parties: readonly DealPartyDraft[]): DealType {
  const base = DEAL_KIND_OPTIONS.find((option) => option.value === kind)?.type ?? "performance";
  if (base !== "performance") return base;
  const entitled = parties.filter(
    (party) => party.participantId !== "" && ENTITLED_ROLES.includes(party.roleInDeal),
  );
  return entitled.length > 1 ? "split" : base;
}

/**
 * A STORED deal read back into the menu's own words, so a deal reads the way it
 * was written. Matched on the pair, because `fee` + `guarantee` is "Fee for a
 * service" while `performance` + `guarantee` is "Guarantee"; a `split` type falls
 * back to its shape, which is what the shares beside it already explain.
 */
export function dealKindLabel(type: string, structure: string | null): string {
  const exact = DEAL_KIND_OPTIONS.find(
    (option) => option.structure === structure && option.type === type,
  );
  if (exact) return exact.label;
  const byStructure = DEAL_KIND_OPTIONS.find((option) => option.structure === structure);
  if (byStructure) return byStructure.label;
  return DEAL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export interface DealStructureOption {
  /** `null` = a paper-only agreement: recorded, signed, never computed. */
  value: DealStructure | null;
  label: string;
  description: string;
}

/**
 * The settlement shapes ALONE — the kinds above, minus the ones that only
 * re-label a shape somebody else already named. A kind IS a shape when its own
 * name is the structure it settles as; `service_fee` is the only one that is not.
 *
 * Kept as its own export because the Create-Event wizard's deal step offers
 * exactly these, and because reading a stored `deals.structure` back into a label
 * must not have to know which relationship was recorded beside it.
 */
export const DEAL_STRUCTURE_OPTIONS: DealStructureOption[] = DEAL_KIND_OPTIONS.filter(
  (option) => option.value === (option.structure ?? "paper_only"),
).map((option) => ({
  value: option.structure,
  label: option.label,
  description: option.description,
}));

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

  // A DEAL THAT PAYS NOBODY IS ALLOWED. See `dealDraftNotices` for the whole of
  // the reasoning; what belongs here is only why it is not a PROBLEM: refusing it
  // made the product unusable alone. An operator with nobody else on the event
  // can name exactly one party — themselves — and this rule then demanded they
  // mark themselves "Is paid" for a night they are running, which is not a thing
  // anybody means. (Product owner: *"A user should be able to use the system also
  // as a standalone if they like."*)
  //
  // The one shape that stays refused is the incoherent one: money declared
  // already paid, to nobody. That is not a policy call — `reconcile()` throws on
  // it (`prepaid.ts`: "states money paid before the event but names no payee"),
  // so allowing it through would swap a legible refusal for a 500 on every
  // subsequent compute. `routes/deals.ts` refuses the same shape server-side.
  if (entitled.length === 0) {
    const advanceStated = amountToMinor(draft.advanceAmount, draft.currency);
    const guaranteeStated = amountToMinor(draft.guaranteeAmount, draft.currency);
    const prepays =
      (advanceStated != null && advanceStated > 0n) ||
      (draft.paymentTiming === "before_event" &&
        guaranteeStated != null &&
        guaranteeStated > 0n &&
        structureNeedsGuarantee(draft.structure));
    if (prepays) {
      problems.push(
        "This deal says money was paid before the event, but names nobody it was paid to. Give a party the Is paid role, or set it to settle at the event.",
      );
    }
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
 * WHAT THE DRAFT DOES NOT REFUSE, BUT MUST NOT DO QUIETLY.
 *
 * A notice is not a problem: it never blocks the send. It exists because the one
 * thing this module's own docstring warns against is a deal that is *"accepted
 * and then quietly settles as nothing"* — and a deal naming nobody it pays is
 * exactly that shape. It is now allowed (a standalone operator has nobody else to
 * name), so the honesty has to move from the refusal to the record.
 *
 * The economics behind the sentence, so it can be checked rather than believed:
 * `reconcile()`'s `settleDeal` returns `0n` the moment a deal has no entitled
 * line, and the operator's entitlement is `pool − Σ everyone else`. So a deal
 * that entitles nobody claims nothing, the whole pool lands on the operator's own
 * line, and `Σ net = 0` holds exactly — proved, not asserted, in
 * `apps/api/src/settlement.test.ts` ("a deal that entitles nobody").
 */
export function dealDraftNotices(draft: DealDraft): string[] {
  const notices: string[] = [];
  const chosen = draft.parties.filter((party) => party.participantId !== "");
  const entitled = chosen.filter((party) => ENTITLED_ROLES.includes(party.roleInDeal));
  if (chosen.length > 0 && entitled.length === 0) {
    notices.push(
      draft.structure === null
        ? "Nobody on this deal is paid by it, and it is agreed manually — the terms are recorded and no figure from it reaches the settlement."
        : "Nobody on this deal is paid by it, so shoWMe will not compute it: the terms are recorded, and the night's money stays with the operator. Give a party the Is paid or Takes a share role to have it settled.",
    );
  }
  return notices;
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

/**
 * TERMS & CONDITIONS — the text of the agreement, and the template it can be
 * saved as.
 *
 * The product owner asked for *"terms and conditions text box and template"* on
 * the agreement, and in the same breath that *"we are not an agreements app"*.
 * Both bind: this is a text field and a reusable template, and deliberately NOT a
 * contract editor — no clause library, no e-signature, no PDF assembly beyond the
 * Share & Export that already prints `agreement_body_text`.
 *
 * The text itself is stored on the deal (`deals.agreement_body_text`, a column
 * that has existed since the agreement was folded into the deal and until now had
 * no writer). It is inside `freezeDealSnapshot`, so the words a party confirms are
 * frozen with the figures — terms that could change after everyone signed would be
 * terms nobody actually agreed to.
 *
 * A saved template rides in `templates.payload` under `category = 'terms'`, which
 * the enum has carried since the first migration — the same mechanism the Budget
 * Planner's "Save as Template" uses (`budget-template.ts`), so there is one
 * template system and not two.
 */

/** The `templates.category` a saved terms text is stored under. */
export const TERMS_TEMPLATE_CATEGORY = "terms" as const;

/** A terms template's stored payload — the text, and nothing else. */
export interface TermsTemplatePayload {
  readonly text: string;
}

export function termsTemplatePayload(text: string): TermsTemplatePayload {
  return { text: text.trim() };
}

/**
 * Read a `templates.payload` back into the text box. Tolerant for the same reason
 * `readBudgetTemplatePayload` is: `payload` is `jsonb` typed `unknown`, and a row
 * written by an older build or edited by hand must degrade to an empty box rather
 * than throw inside a screen the operator has already opened.
 */
export function readTermsTemplateText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
