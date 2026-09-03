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
    case "pending_review":
      return { status: "task", label: "Pending review" };
    // `open` is the default a settlement is BORN at, and it used to fall through
    // to the catch-all below and be badged "Pending review" — so an untouched
    // settlement claimed in its header that it had been sent out, directly above
    // a progress rail correctly showing "Open" as the current stop. Two places on
    // one screen disagreeing about the same fact.
    default:
      return { status: "task", label: "Open" };
  }
}

/**
 * The settlement's journey — the prototype's seven stops, and every one of them
 * is now a status something really writes.
 *
 *   Open              the default; figures can still move
 *   Pending review    `POST /settlement/status`
 *   Comments received set automatically when a party posts a remark
 *   Revised           `POST /settlement/status` after the operator adjusts
 *   Finalized         `POST /settlement/finalize` — locks the figures AND the FX
 *   Partly paid       DERIVED from the transfers
 *   Paid              DERIVED from the transfers
 *
 * This was briefly five stops, correctly: before the status machine landed, only
 * `open` and `finalized` were reachable and a seven-stop rail would have been four
 * lamps that never lit. Now that `pending_review`, `comments_received` and
 * `revised` have a route and `partly_paid`/`paid` fall out of the transfers, the
 * design's rail is honest and restored.
 *
 * `dispute` is still not a stop: it is a flag ON a stage rather than a stage of
 * its own — a disputed settlement is wherever it was, with a party objecting — so
 * the badge says so and the rail keeps its place. A dispute is not progress.
 */
const STAGE_OF: Record<string, number> = {
  open: 0,
  pending_review: 1,
  comments_received: 2,
  revised: 3,
  dispute: 2,
  finalized: 4,
  partly_paid: 5,
  paid: 6,
  concluded: 4,
};

const STAGE_LABELS = [
  "Open",
  "Pending review",
  "Comments received",
  "Revised",
  "Finalized",
  "Partly paid",
  "Paid",
] as const;

export function settlementSteps(status: string): SettlementStep[] {
  // An unknown status sits at the start rather than inventing a stop for itself.
  const reached = STAGE_OF[status] ?? 0;
  return STAGE_LABELS.map((label, index) => ({
    label,
    state: index < reached ? "done" : index === reached ? "active" : "pending",
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
export function entitlementRules(
  computed: ComputedBreakdown,
  currency: string,
  /**
   * How to render a money amount. The settlement screen passes a converting
   * formatter when the reader is previewing in another currency, so the RULE and
   * the figure it explains are always in the same one.
   *
   * `currency` is still needed separately: `describeBasis` renders operands that
   * are part of the sentence rather than the amount.
   */
  formatAmount: (minorUnits: string) => string = (minorUnits) => formatMoney(minorUnits, currency),
): EntitlementRule[] {
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
      value: formatAmount(line.amount),
    });
    if (line.bonus != null && line.bonus !== "0") {
      rules.push({
        key: `bonus-${line.dealId}`,
        label: line.escalatorApplied
          ? "Includes the bonus and the escalator tier the night reached"
          : "Includes the threshold bonus",
        value: formatAmount(line.bonus),
      });
    }
    if (line.commissionCharged != null && line.commissionCharged !== "0") {
      rules.push({
        key: `commission-${line.dealId}`,
        label: "Less the disclosed commission on this line",
        value: formatAmount(line.commissionCharged),
        negative: true,
      });
    }
  }

  if (computed.commissionEarned != null && computed.commissionEarned !== "0") {
    rules.push({
      key: "commission-earned",
      label: "Disclosed commission earned on other parties' lines",
      value: formatAmount(computed.commissionEarned),
    });
  }
  if (computed.residual != null && computed.residual !== "0") {
    rules.push({
      key: "residual",
      label: "What is left after every other party is paid",
      value: formatAmount(computed.residual),
    });
  }
  if (computed.deductibles != null && computed.deductibles !== "0") {
    rules.push({
      key: "deductibles",
      label: "Less costs somebody else fronted on your behalf",
      value: formatAmount(computed.deductibles),
      negative: true,
    });
    /*
     * AND WHICH COSTS THOSE WERE — ClickUp `86cbcn1ue`: *"A detailed view of all
     * items divided to each collaborator's share."*
     *
     * The line above says how much came off; these say what it was. It is the
     * question a performer asks first and the one the card could not answer: a
     * single "Less costs somebody else fronted on your behalf — 3 500" is exactly
     * the unexplained figure that starts a settlement argument.
     *
     * Each entry is this party's OWN portion of the line, so they sum to the total
     * above — which is what makes the breakdown checkable rather than decorative.
     * Absent on a settlement snapshotted before the engine recorded them, and the
     * card then shows the total alone rather than inventing an itemisation.
     */
    for (const [index, line] of (computed.deductibleLines ?? []).entries()) {
      rules.push({
        key: `deductible-${index}`,
        label: `— ${line.label}`,
        value: formatAmount(line.amount),
        negative: true,
      });
    }
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
export function ladderRows(
  ladder: PoolLadder,
  currency: string,
  /** Converting formatter when the reader is previewing another currency. */
  formatAmount: (minorUnits: string) => string = (minorUnits) => formatMoney(minorUnits, currency),
): LadderRow[] {
  return [
    { key: "revenue", label: "Revenue", value: formatAmount(ladder.revenue) },
    {
      key: "costs",
      label: "Costs nobody was charged for",
      value: formatAmount(ladder.costs),
      negative: true,
    },
    /*
     * "POOL" WAS THE ONE RUNG THAT DID NOT EXPLAIN ITSELF.
     *
     * Ran asked outright on ClickUp `86cbcn1ue`: *"what does 'Pool' mean?"* — and
     * read down the ladder, the question answers why. Every other rung is already
     * a plain-English description of what it is ("Costs nobody was charged for",
     * "Rentals settled off the top", "Adjusted net"). One bare noun sat among them
     * naming a concept the reader was expected to already hold.
     *
     * The word is KEPT, not replaced. It is what the deal screens say ("Share of
     * the pool"), what the engine calls it, and what a settlement in this industry
     * is discussed in — deleting it here would just move the confusion one screen
     * along and leave the two disagreeing. Pairing it with its meaning makes it
     * learnable instead: read once, and "share of the pool" next door is suddenly
     * a sentence about a number you have seen.
     *
     * NOT a definition paragraph under the row, deliberately — the same ticket
     * objects to *"many unneeded text (so called notes to explain the features)"*.
     * A label that says what it is costs no lines at all.
     *
     * The other "pool" strings (`DealComposerModal`, `EventAgreementTab`,
     * `NewEventWizard`) are left exactly as they are. Renaming the vocabulary
     * across the deal screens is the terminology session's call, not a guess to
     * make on the way past — this file has a four-round rename history one screen
     * over that says what guessing costs.
     */
    { key: "pool", label: "Left to divide (the pool)", value: formatAmount(ladder.pool) },
    {
      key: "off-the-top",
      label: "Rentals settled off the top",
      value: formatAmount(ladder.offTheTop),
      negative: true,
    },
    {
      key: "split-pool",
      label: "Adjusted net",
      value: formatAmount(ladder.splitPool),
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
