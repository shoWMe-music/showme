import type { getApiV1EventsIdSettlements } from "@showme/api-client";
import type { Status } from "@showme/design-system";
import { basisPointsToPercent } from "@showme/shared";
import { formatMoney } from "../lib/format";
import type { SettlementStep } from "./SettlementStepper";
import type { TransferState } from "./WhoOwesWhomBoard";

/**
 * Pure readers for a settlement, shared by the Settlements table row and the
 * settlement detail overlay. They live outside both components so the two
 * surfaces can never disagree about what a status means or which figure is which.
 *
 * NOTHING here does money arithmetic. The settlement engine
 * (`packages/settlement`) is authoritative and its result is frozen into
 * `settlements.computed` at finalize; a second implementation in the browser is
 * exactly the drift audit A-13 was. Every amount rendered is a field the API
 * served, formatted and nothing else.
 */

/**
 * The row the Settlements list already holds, and the only event context the
 * detail overlay needs.
 *
 * The overlay is handed the row rather than re-fetching it by id (the invoice
 * overlay's pattern) because there is no `GET /settlements/:id` — the list route
 * `GET /settlements` is the only place the event title, its date and the event's
 * base currency are served together with the settlement. The per-event read the
 * overlay *does* make (`GET /events/:id/settlements`) carries neither an event
 * title nor a currency.
 */
export interface SettlementListRow {
  id: string;
  status: string;
  /** The caller's OWN participant row — which line in the board is theirs. */
  participantId: string | null;
  /** `events.base_currency`; every figure in a settlement is denominated in it. */
  currency: string;
  event: { id: string; title: string; eventDate: string | null; status: string };
}

/** `settlement_status` → the design system's status vocabulary + a human label. */
export function settlementStatusToDisplay(status: string): { status: Status; label: string } {
  switch (status) {
    case "finalized":
      return { status: "confirmed", label: "Finalized" };
    case "paid":
      return { status: "confirmed", label: "Paid" };
    case "partly_paid":
      return { status: "pending", label: "Partly paid" };
    case "comments_received":
      return { status: "pending", label: "Comments" };
    case "revised":
      return { status: "pending", label: "Revised" };
    case "dispute":
      return { status: "cancelled", label: "Dispute" };
    default:
      return { status: "task", label: "Pending review" };
  }
}

/** How far along the settlement process a status sits. */
const STATUS_STAGE_INDEX: Record<string, number> = {
  open: 0,
  draft: 0,
  pending: 1,
  pending_review: 1,
  review: 1,
  comments_received: 1,
  finalized: 2,
  revised: 2,
  partly_paid: 3,
  paid: 3,
  concluded: 3,
};

const STAGE_LABELS = ["Open", "Pending review", "Finalized", "Paid"];

/** The four-stop process rail for one settlement's status. */
export function settlementSteps(status: string): SettlementStep[] {
  const active = STATUS_STAGE_INDEX[status] ?? 0;
  return STAGE_LABELS.map((label, index) => ({
    label,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));
}

/** `settlement_transfers.state` → the board's three payment states. */
export function transferStateOf(raw: string | null | undefined): TransferState {
  if (raw === "paid") return "paid";
  if (raw === "handled") return "handled";
  return "owed";
}

/**
 * Which way a net line leans: positive = owed to this party, negative = they are
 * holding more cash than they are entitled to. A comparison, not arithmetic —
 * the number itself is the engine's.
 */
export function netToneOf(net: string): "positive" | "negative" | "neutral" {
  const value = Number(net);
  if (!Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

/** Up to two initials for an avatar. */
export function initialsOf(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Whether the visible lines are the WHOLE board.
 *
 * `Σ net = 0` is an invariant of every party on the event, and the engine asserts
 * it at compute time — so a non-zero sum here never means the books are wrong, it
 * means the payload was party-scoped and the missing lines are the ones the caller
 * may not see (a performer gets her own line, not the operator's). Rendering
 * "Not balanced" over a redacted slice would report authorization as an accounting
 * error, so the badge is claimed only when the sum actually lands on zero.
 */
export function isWholeBoard(nets: string[]): boolean {
  if (nets.length === 0) return false;
  return nets.reduce((total, net) => total + Number(net), 0) === 0;
}

/* ── The RULE behind a figure ─────────────────────────────────────────────────
   A settlement that prints only amounts asks the parties to take it on trust.
   Every number below arrives from the engine already decided — which arm of the
   deal fired, what percentage, of which pool — and these readers turn that
   decision into the sentence a person checks against their contract. They format
   and compare; they never compute. */

type EventSettlements = Awaited<ReturnType<typeof getApiV1EventsIdSettlements>>;
type ComputedBreakdown = NonNullable<EventSettlements["settlements"][number]["computed"]>;

/** One deal's contribution to a party's entitlement, as the API serves it. */
export type EntitlementLine = NonNullable<ComputedBreakdown["lines"]>[number];

/** Gross → adjusted net. Null for a party who may not read the pool. */
export type PoolLadder = NonNullable<EventSettlements["ladder"]>;

/** One party's sign-off on the roster. */
export type SettlementApproval = EventSettlements["approvals"][number];

/**
 * The rule in words: *"70% door beats the €50,000 guarantee"*.
 *
 * One sentence per arm of `dealEntitlement()`, and the operands are the engine's
 * own — `won` in particular is the engine's answer to which side of the
 * comparison paid, not a comparison redone here against figures that may have
 * been rounded for display.
 */
export function describeBasis(basis: EntitlementLine["basis"], currency: string): string {
  switch (basis.kind) {
    case "guarantee":
      return `Guaranteed ${formatMoney(basis.guarantee, currency)}`;
    case "rental":
      return `Rental of ${formatMoney(basis.rental, currency)}, settled off the top`;
    case "door_split":
      // The pool is redacted for a party who may not read it (story.md:44), so the
      // sentence names the RULE and drops the base rather than printing a hole.
      // Their own percentage is theirs and is never redacted.
      return basis.pool == null
        ? `${basisPointsToPercent(basis.basisPoints)}% of the adjusted net`
        : `${basisPointsToPercent(basis.basisPoints)}% of the adjusted net ${formatMoney(basis.pool, currency)}`;
    case "guarantee_vs_door":
      return basis.won === "door"
        ? `${basisPointsToPercent(basis.basisPoints)}% of the adjusted net beats the ${formatMoney(basis.guarantee, currency)} guarantee`
        : `The ${formatMoney(basis.guarantee, currency)} guarantee beats ${basisPointsToPercent(basis.basisPoints)}% of the adjusted net`;
    default:
      return "A paper agreement — nothing for the settlement to compute";
  }
}

/** A label ↔ amount pair explaining one component of an entitlement. */
export interface EntitlementRule {
  key: string;
  label: string;
  value: string;
  /** Money coming OFF the entitlement — rendered as a subtraction. */
  negative?: boolean;
}

/**
 * The four ways a party can be credited, in the order they read.
 *
 * The list is empty for a settlement snapshotted before the engine recorded any
 * of this — which is honest, and the reason the card falls back to showing the
 * bare entitlement rather than inventing an explanation for it.
 */
export function entitlementRules(computed: ComputedBreakdown, currency: string): EntitlementRule[] {
  const rules: EntitlementRule[] = [];

  for (const line of computed.lines ?? []) {
    // A shared split pays the DEAL a total and this party a PORTION of it. Naming
    // only the portion leaves a performer on a 60/40 unable to check the split they
    // agreed, so when the two differ the sentence carries both. The comparison is
    // against the portion BEFORE any commission came off it, which is the figure
    // `allocate()` actually handed this line.
    const portionBeforeCommission = BigInt(line.amount) + BigInt(line.commissionCharged ?? "0");
    const isShared = portionBeforeCommission !== BigInt(line.dealTotal);
    rules.push({
      key: `deal-${line.dealId}`,
      label: isShared
        ? `${describeBasis(line.basis, currency)} — your share of ${formatMoney(line.dealTotal, currency)}`
        : describeBasis(line.basis, currency),
      value: formatMoney(line.amount, currency),
    });
    if (line.bonus != null && line.bonus !== "0") {
      rules.push({
        key: `bonus-${line.dealId}`,
        label: line.escalatorApplied
          ? "Includes the bonus and the escalator tier the night reached"
          : "Includes the threshold bonus",
        value: formatMoney(line.bonus, currency),
      });
    }
    if (line.commissionCharged != null && line.commissionCharged !== "0") {
      rules.push({
        key: `commission-${line.dealId}`,
        label: "Less the disclosed commission on this line",
        value: formatMoney(line.commissionCharged, currency),
        negative: true,
      });
    }
  }

  if (computed.commissionEarned != null && computed.commissionEarned !== "0") {
    rules.push({
      key: "commission-earned",
      label: "Disclosed commission earned on other parties' lines",
      value: formatMoney(computed.commissionEarned, currency),
    });
  }
  if (computed.residual != null && computed.residual !== "0") {
    rules.push({
      key: "residual",
      label: "What is left after every other party is paid",
      value: formatMoney(computed.residual, currency),
    });
  }
  if (computed.deductibles != null && computed.deductibles !== "0") {
    rules.push({
      key: "deductibles",
      label: "Less costs somebody else fronted on your behalf",
      value: formatMoney(computed.deductibles, currency),
      negative: true,
    });
  }
  return rules;
}
