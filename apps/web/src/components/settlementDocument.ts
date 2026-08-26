import type { getApiV1EventsIdSettlements, getApiV1Settlements } from "@showme/api-client";
import type { Status } from "@showme/design-system";
import { basisPointsToPercent } from "@showme/shared";
import { formatAmount, formatMoney } from "../lib/format";
import type { SettlementStep } from "./SettlementStepper";
import type { TransferState } from "./WhoOwesWhomBoard";

/**
 * Pure readers for a settlement, shared by the Settlements list, the event
 * workspace's Settlement tab and the full settlement workspace. They live outside
 * all three so no two surfaces can disagree about what a status means, which
 * figure is which, or which rule a line settled under.
 *
 * NOTHING here does money arithmetic. The settlement engine
 * (`packages/settlement`) is authoritative and its result is frozen into
 * `settlements.computed` at finalize; a second implementation in the browser is
 * exactly the drift audit A-13 was. Every amount rendered is a field the API
 * served, formatted and nothing else.
 */

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

/**
 * The process rail — and it has TWO stops, not the prototype's seven.
 *
 * `settlement_status` has eight values and the API writes exactly two of them:
 * `open` is the column default (`packages/db/src/schema/settlement.ts:148`) and
 * `finalized` is written by `POST /events/:id/settlement/finalize`. Nothing in
 * `apps/api` ever writes `pending_review`, `comments_received`, `revised`,
 * `partly_paid`, `paid` or `dispute` — measured, not assumed.
 *
 * So a seven-stop rail would draw five stops no settlement can ever reach, which
 * is a dead affordance wearing a progress bar (STYLE-GUIDE §7): it promises a
 * review-and-dispute workflow this product does not have yet. Payment progress is
 * real, but it lives on the individual TRANSFERS (owed → paid → handled) and is
 * shown on the who-owes-whom board, not on the settlement's own status.
 *
 * Any other value still renders — a row could carry one from a fixture — and it
 * simply sits at whichever stop it maps to rather than inventing a stop for itself.
 */
const FROZEN_STAGE: ReadonlySet<string> = new Set([
  "finalized",
  "revised",
  "partly_paid",
  "paid",
  "concluded",
]);

export function settlementSteps(status: string): SettlementStep[] {
  const frozen = FROZEN_STAGE.has(status);
  return [
    { label: "Open", state: frozen ? "done" : "active" },
    { label: "Finalized", state: frozen ? "active" : "pending" },
  ];
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

/** One rung of the pool ladder, already formatted. */
export interface LadderRow {
  key: string;
  label: string;
  value: string;
  /** Money coming OFF the running figure — rendered as a subtraction. */
  negative?: boolean;
  /** The adjusted net: the figure every percentage below it is a share of. */
  total?: boolean;
}

/**
 * Gross takings → adjusted net, the five rungs the engine already computed.
 *
 * This is the prototype's "Revenue & deductions" totals block, and it is the whole
 * reason a settlement reads as arithmetic rather than as an assertion: without the
 * base, "70% of the adjusted net" names a rule nobody can check. `splitPool` is
 * that base — the reference app called it `adjustedNet` — and `offTheTop` is the
 * rentals that settled before the percentage deals divided what was left.
 *
 * OPERATOR ONLY, and the caller does not choose: the route serves `ladder: null`
 * to anyone without `budget.view` (story.md:44), so a party who may not read the
 * night's takings has nothing here to format. Formats; never computes.
 */
export function ladderRows(ladder: PoolLadder, currency: string): LadderRow[] {
  return [
    { key: "revenue", label: "Revenue", value: formatMoney(ladder.revenue, currency) },
    {
      key: "costs",
      label: "Costs nobody was charged for",
      value: formatMoney(ladder.costs, currency),
      negative: true,
    },
    { key: "pool", label: "Pool", value: formatMoney(ladder.pool, currency) },
    {
      key: "off-the-top",
      label: "Rentals settled off the top",
      value: formatMoney(ladder.offTheTop, currency),
      negative: true,
    },
    {
      key: "split-pool",
      label: "Adjusted net",
      value: formatMoney(ladder.splitPool, currency),
      total: true,
    },
  ];
}

/* ── The caller's own money, across every event ───────────────────────────────
   Summed rather than counted: "outstanding" is the number that matters when it
   is yours. Shared by the Settlements screen and the dashboard band so the two
   can never disagree — a second summation in the other component is exactly the
   drift this module exists to prevent. */

/** One row of `GET /settlements` — every settlement the caller is a party to. */
export type SettlementListItem = Awaited<ReturnType<typeof getApiV1Settlements>>["items"][number];

/** The four headline figures, already formatted. */
export interface SettlementTotals {
  settled: string;
  pending: string;
  outstanding: string;
  finalized: string;
}

/**
 * Sum the caller's entitlements by status.
 *
 * `entitlement` is null until the event has been computed — a real "not yet" — so
 * those rows are skipped rather than counted as zero. With no rows at all every
 * figure is an em dash: nothing has settled, and "0" would assert a total that was
 * never calculated.
 */
export function settlementTotals(settlements: SettlementListItem[]): SettlementTotals {
  const sum = (predicate: (row: SettlementListItem) => boolean) =>
    settlements
      .filter((row) => row.entitlement != null && predicate(row))
      .reduce((total, row) => total + BigInt(row.entitlement as string), 0n);
  const currency = settlements[0]?.currency ?? null;
  const format = (amount: bigint) =>
    settlements.length === 0
      ? "—"
      : currency
        ? formatMoney(amount.toString(), currency)
        : formatAmount(amount.toString());
  return {
    settled: format(sum((row) => row.status === "paid")),
    pending: format(sum((row) => row.status === "open" || row.status === "comments_received")),
    outstanding: format(sum((row) => row.status !== "paid")),
    finalized: format(sum((row) => row.status === "finalized")),
  };
}
