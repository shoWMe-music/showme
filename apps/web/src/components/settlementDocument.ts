import type { getApiV1EventsIdSettlements, getApiV1Settlements } from "@showme/api-client";
import type { Status } from "@showme/design-system";
import { basisPointsToPercent } from "@showme/shared";
import { formatAmount, formatDay, formatMoney, possessiveOf } from "../lib/format";
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

/**
 * What the head of a settlement reads over the reader's OWN figure.
 *
 * The figure underneath is the party's NET — what actually moves — and a net can
 * point either way, because `Σ net = 0` across the event. So the label has to name
 * the direction: "Your payout" is a claim about money coming TO the reader, and it
 * is false over a negative net.
 *
 * Measured 2026-09-28 (QA7-28): the Settlement tab labelled the reader's
 * ENTITLEMENT "Your payout", and the two differ whenever anything sits between them
 * — an advance, a deduction, cash the party is holding. An operator owing SEK 45,000
 * to two acts was shown SEK 0 with the word "payout" beside it.
 *
 * The vocabulary is `ShareViewer`'s, which already says "You owe" about a transfer
 * going the other way, rather than a third phrasing for the same fact.
 *
 * A zero keeps "Your payout": nothing moves, and a labelled zero says that without
 * needing a sentence of its own.
 */
export function ownFigureLabel(netTone: "positive" | "negative" | "neutral"): string {
  return netTone === "negative" ? "You owe" : "Your payout";
}

/**
 * A NEGATIVE FIGURE, WRITTEN ONE WAY (QA sweep run 9, QA9-14).
 *
 * Five call sites drew their own: four as `− ${value}` and one as `−${value}`, so a single
 * "Revenue & deductions" card printed `−SEK 12,000` in its line items and `− SEK 33,000` in
 * its own summary rows directly beneath. QA8-12 had already unified the GLYPH — U+2212
 * everywhere, the hyphen gone — and left the spacing, which is the half a reader actually
 * notices when the two sit in one column.
 *
 * Worse than the inconsistency: the comment beside the odd one out claimed *"the two agree
 * about what a negative figure looks like on this screen"*. They did not. That is the ninth
 * instance this stretch of a comment asserting a rule the code does not keep, and it was
 * written by this loop.
 *
 * U+2212 MINUS SIGN and a space, not a hyphen and not `-`: a hyphen is a word-joiner at the
 * same size as a digit, and in a monospace column of money the space is what stops `−SEK`
 * reading as one token.
 */
export function negativeAmount(value: string): string {
  return `− ${value}`;
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

/**
 * A row under the card's divider: something that moves the PAYOUT without being part of
 * the entitlement above it.
 */
export interface PayoutAdjustment {
  key: string;
  label: string;
  /** The magnitude, formatted. The sign is `reducesPayout`, not a character in here. */
  value: string;
  /** True when it takes the payout further from the entitlement rather than nearer. */
  reducesPayout: boolean;
}

/**
 * WHY THE PAYOUT IS NOT THE ENTITLEMENT (QA sweep run 8, QA8-5; QA7-10 for the advance).
 *
 * The rules above the divider sum to the entitlement, which is the card's headline. These
 * are the cash terms that sit between it and what actually moves, straight out of the
 * engine's own arithmetic:
 *
 *     net = entitlement − held,  held = collected − paid + prepaid
 *
 * so, read as adjustments to the entitlement: money this party already COLLECTED reduces
 * what is still coming to them, costs they PAID increase it, and an advance does whichever
 * its direction says. Nothing here is negated in the label — `reducesPayout` carries the
 * direction so one renderer draws the sign, the same rule `prepaidReducesPayout` follows.
 *
 * `paid` is the answer to a complaint of its own: the SEK 10,800 an operator had fronted
 * appeared nowhere on their card, while the workspace's Payout tab printed it.
 *
 * PERSON-AWARE, and that is QA6-9's finding rather than a nicety — once #24.2 puts another
 * party's card in front of a reader, *"the money you collected"* under the operator's name
 * tells a performer they took a hundred thousand they never touched. Same `owner` argument
 * and same three-way naming as `entitlementRules`.
 */
export function payoutAdjustments(
  computed: ComputedBreakdown,
  currency: string,
  formatAmount: (minorUnits: string) => string = (minorUnits) => formatMoney(minorUnits, currency),
  owner: { isYours: boolean; name: string } = { isYours: true, name: "" },
  /** The advance's own sentence, which names both ends and is built where the names are. */
  prepaidLabel: string | null = null,
): PayoutAdjustment[] {
  const adjustments: PayoutAdjustment[] = [];
  const who = owner.isYours ? "you" : owner.name || "that party";

  if (computed.collected != null && computed.collected !== "0") {
    adjustments.push({
      key: "collected",
      label: `Less the money ${who} collected on the night`,
      value: formatAmount(computed.collected),
      reducesPayout: true,
    });
  }
  if (computed.paid != null && computed.paid !== "0") {
    adjustments.push({
      key: "paid",
      label: `Plus the costs ${who} paid on the night`,
      value: formatAmount(computed.paid),
      reducesPayout: false,
    });
  }
  if (computed.prepaid != null && computed.prepaid !== "0" && prepaidLabel) {
    // A POSITIVE prepaid is money this party received early, so it comes off what is
    // still owed; the payer's is negative and goes the other way. The magnitude is what
    // renders, so the sign is read once, here.
    const received = !computed.prepaid.startsWith("-");
    adjustments.push({
      key: "prepaid",
      label: prepaidLabel,
      value: formatAmount(received ? computed.prepaid : computed.prepaid.slice(1)),
      reducesPayout: received,
    });
  }
  return adjustments;
}

/**
 * WHY THE ENTITLEMENTS DO NOT SUM TO THE ADJUSTED NET — in the words the night's own
 * figures support, and **only** those.
 *
 * This sentence has now been wrong twice, both times by asserting a cause
 * unconditionally:
 *
 *  - run 5 (**QA5-1**) — a co-promotion whose gap was entirely a withheld party read
 *    *"each line also carries the cash that party collected and the deductions taken
 *    off them"* on a settlement where nobody collected anything and `deductibles` was
 *    `0` on every row;
 *  - run 6 (**QA6-4**) — the same clause survived in the other branch. An off-the-top
 *    venue rental of 5,000 leaves the entitlements 5,000 ABOVE the adjusted net, and
 *    with full access granted there was nothing withheld to name. `deductibles` `0`,
 *    `0`, `0` again.
 *
 * So the causes are asked in the order they explain the gap, and the last branch says
 * the difference and stops. A reader sent looking for cash nobody took is worse off
 * than one told only that two numbers differ.
 *
 * Pure, and per-branch tested, because that is the only way a sentence like this stops
 * being re-broken: the wrong answer does not throw, it reads perfectly well.
 */
export function entitlementGapSentence(input: {
  /** Σ entitlement over the parties this reader can see, in minor units. */
  entitlementsMinor: bigint;
  adjustedNetMinor: bigint;
  /** Σ owed to parties paid by transfer whose settlement is withheld — `withheldPayees`. */
  withheldMinor: bigint;
  /**
   * HOW MANY PARTIES ARE ON THIS NIGHT WHOSE SETTLEMENT THIS READER CANNOT READ —
   * `withheldPartyCount` below, from the `approvals` roster the response already serves.
   *
   * `withheldMinor` above covers only the ones this reader PAYS, because it is derived from
   * transfers. A co-operator with a negative net pays IN, so it finds nothing and the gap fell
   * through to the cash-and-deductions branch, which blamed a cause the figures do not support
   * (QA sweep run 11, QA11-2: the host read *"…come to SEK 85,000"* with Northlight's
   * −SEK 15,000 nowhere on the page).
   */
  withheldPartyCount: number;
  /** What left the pool before the adjusted net was struck (`ladder.offTheTop`). */
  offTheTopMinor: bigint;
  /** Σ cash collected by the visible parties. */
  collectedMinor: bigint;
  /** Σ deductions taken off the visible parties. */
  deductiblesMinor: bigint;
  format: (minorUnits: string) => string;
}): string | null {
  const { entitlementsMinor, adjustedNetMinor, format } = input;
  if (entitlementsMinor === adjustedNetMinor) return null;

  const direction = entitlementsMinor > adjustedNetMinor ? "more" : "less";
  const opening = `The entitlements below come to ${format(entitlementsMinor.toString())}, ${direction} than the adjusted net`;
  const shares = "The percentages are shares of the entitlements shown.";

  // 1. A WITHHELD LINE, when there is one. A lower bound — what this reader transfers
  //    that party is their entitlement less any cash they already hold — so "at least".
  if (input.withheldMinor > 0n) {
    return `${opening}. At least ${format(input.withheldMinor.toString())} of it belongs to a party whose settlement is not shared with you; it is in Total Payouts as a transfer. ${shares}`;
  }

  // 2. MONEY TAKEN OFF THE TOP, which is the only way the entitlements can exceed the
  //    pool they divide: a rental settled before the adjusted net is struck is in the
  //    payee's entitlement and not in the base.
  if (input.offTheTopMinor > 0n && entitlementsMinor > adjustedNetMinor) {
    return `${opening}. ${format(input.offTheTopMinor.toString())} was settled off the top. It is in a party's entitlement and not in the net the percentages divide. ${shares}`;
  }

  /*
   * 3. A PARTY IS MISSING FROM THE LIST, which dominates any arithmetic explanation of the
   *    same gap: the rows shown cannot add up to the pool when the pool was divided among
   *    more parties than are on screen. Named as a count, never a figure — #4 withholds the
   *    money and the `approvals` roster already names who is on the night.
   */
  if (input.withheldPartyCount > 0) {
    const parties =
      input.withheldPartyCount === 1
        ? "one party on this night whose settlement is not shared with you"
        : `${input.withheldPartyCount} parties on this night whose settlements are not shared with you`;
    return `${opening}. The list leaves out ${parties}, so it does not sum to the pool. ${shares}`;
  }

  // 4. The original cause, now stated only when the rows actually carry it.
  if (input.collectedMinor !== 0n || input.deductiblesMinor !== 0n) {
    return `${opening}: each line also carries the cash that party collected and the deductions taken off them. ${shares}`;
  }

  // 5. Nothing here explains it, so nothing is claimed.
  return `${opening}. ${shares}`;
}

/**
 * HOW MANY PARTIES ON THIS NIGHT THIS READER HAS NO SETTLEMENT FOR.
 *
 * The answer was already in the payload and no screen asked it. `approvals` is built from
 * `addressableSettlements` — every party with a settlement row — because the route decided long
 * ago that *"addressing somebody is not reading their money"*; it is what the Approval Status
 * roster counts `0/5` from. `settlements` is the scoped subset. The difference is exactly the
 * parties #4 withholds, and a COUNT of them discloses nothing the roster does not already print.
 *
 * Deliberately not a list of names here: the sentence this feeds says how many, and the roster
 * beside it says who. Two renderings of one set, and the one that carries money stays scoped.
 */
export function withheldPartyCount(
  approvals: readonly { participantId: string }[],
  visibleParticipantIds: readonly (string | null | undefined)[],
): number {
  const visible = new Set(visibleParticipantIds.filter((id): id is string => id != null));
  return approvals.filter((approval) => !visible.has(approval.participantId)).length;
}

/**
 * THE PARTIES THIS READER PAYS BUT CANNOT READ A SETTLEMENT FOR.
 *
 * Two scopes, one payload. `GET /events/:id/settlements` scopes the party list
 * through `partiesVisibleTo` — emergent from being party to a DEAL, which a
 * co-operator never is — and scopes the TRANSFERS separately, through `isMyEnd`,
 * which does reach whoever pays them. So the host is handed a transfer to a party
 * whose settlement row is deliberately withheld, and every total built from the
 * party list alone is short by exactly that (QA sweep run 5, QA5-1: an operator's
 * "Total payable" read SEK 56,000 above its own transfer list of 56,000 + 7,200).
 *
 * Returns one entry per withheld payee with the minor units owed, summed — a party
 * paid across two legs is one payout, not two. Amounts stay strings: this is the
 * only arithmetic, it is in `BigInt`, and nothing here formats (`docs/money.md`).
 *
 * NOT A LEAK. The counterparty's `participantId` is already in the transfer this
 * caller was served, and the who-owes-whom board already renders their name. What
 * stays withheld is their SETTLEMENT — entitlement, collections, ladder — and none
 * of it is reconstructed here.
 */
export function withheldPayees(
  transfers: readonly {
    fromParticipantId?: string | null;
    toParticipantId?: string | null;
    amount: string;
    representationId?: string | null;
  }[],
  options: { ownParticipantId: string | null; visibleParticipantIds: readonly string[] },
): { participantId: string; amountMinor: string }[] {
  const { ownParticipantId } = options;
  if (!ownParticipantId) return [];
  const visible = new Set(options.visibleParticipantIds);
  const owed = new Map<string, bigint>();
  for (const transfer of transfers) {
    // A representation transfer is the agent's private commission, paid out of the
    // act's entitlement — it belongs to the commission card and never to this list
    // (decisions.md #14, and the same filter the who-owes-whom list applies).
    if (transfer.representationId) continue;
    if (transfer.fromParticipantId !== ownParticipantId) continue;
    const payee = transfer.toParticipantId;
    if (!payee || visible.has(payee)) continue;
    owed.set(payee, (owed.get(payee) ?? 0n) + BigInt(transfer.amount));
  }
  return (
    [...owed.entries()]
      // Largest first, the same order the payout list is read in.
      .sort((left, right) => (right[1] > left[1] ? 1 : right[1] < left[1] ? -1 : 0))
      .map(([participantId, amount]) => ({ participantId, amountMinor: amount.toString() }))
  );
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
export function describeBasis(
  basis: EntitlementLine["basis"],
  currency: string,
  /**
   * The CONVERTING formatter, when the card is being previewed in another currency
   * (QA sweep run 8's QA7-24 re-read).
   *
   * Without it this sentence rendered its operands in the deal's payout currency while
   * every amount around it was converted, so a card previewed in EUR read *"The 70% door
   * share beats the **SEK 18,000** guarantee"* beside `≈ €6,731` and `≈ €4,013` — one
   * sentence inviting a comparison across two currencies.
   *
   * Given it, a contract figure carries BOTH: `SEK 18,000 (≈ €1,554)`. The payout currency
   * stays first and stays authoritative, because that is the number in the agreement and
   * `docs/money.md` makes a live rate cosmetic — it never settles anything. Omitted, or
   * identical to the payout rendering, the sentence is unchanged, which is every caller on
   * a card that is not being previewed.
   */
  convert?: (minorUnits: string) => string,
): string {
  /** A figure the AGREEMENT states: its own currency, and the reader's beside it. */
  const contract = (minorUnits: string): string => {
    const own = formatMoney(minorUnits, currency);
    if (!convert) return own;
    const shown = convert(minorUnits);
    return shown === own ? own : `${own} (${shown})`;
  };
  switch (basis.kind) {
    case "guarantee":
      return `Guaranteed ${contract(basis.guarantee)}`;
    case "rental":
      /*
       * TWO SENTENCES, because there are now two ways a rental settles (decisions §25.7.1).
       *
       * `borneByPayer` — the deal named who owes it, so the amount moved between two named parties
       * and never touched the pool. The old sentence asserted the other case for both, and on the
       * PAYER's card it appeared beside a negative figure: "settled off the top" over money the
       * party was paying, on a night whose adjusted net the rental had not touched.
       *
       * Neither sentence names the counterparty, which is a real loss and a deliberate one: this
       * function has the basis and the currency, not the roster, and inventing a lookup for it here
       * would put a second opinion about who the parties are next to the serializer's.
       */
      return basis.borneByPayer
        ? `Rental of ${contract(basis.rental)}, settled between its parties`
        : `Rental of ${contract(basis.rental)}, settled off the top`;
    case "door_split":
      // The base is redacted for a party who may not read the event's takings
      // (story.md:44), so the sentence names the RULE and drops the figure rather
      // than printing a hole. Their own percentage is theirs and is never redacted.
      //
      // "the adjusted net", which is what it now is (2026-09-15) and what the
      // design's own party card says: *"20% of adjusted net"*. Between
      // 2026-09-13 and 2026-09-15 this read "of the door" and was true; saying it
      // now would tell a party that no cost had come off the figure they are
      // being paid a share of, when every cost has.
      return basis.base == null
        ? `${basisPointsToPercent(basis.basisPoints)}% of the adjusted net`
        : `${basisPointsToPercent(basis.basisPoints)}% of the adjusted net ${contract(basis.base)}`;
    case "guarantee_vs_door":
      // "the door share" NAMES THE ARM of the deal, which is the design's own
      // phrasing ("70% door beats €50,000 gtee") and the industry's. It is not a
      // claim about the base — that is the adjusted net, and the `door_split`
      // sentence above says so where the figure itself is being described.
      return basis.won === "door"
        ? `The ${basisPointsToPercent(basis.basisPoints)}% door share beats the ${contract(basis.guarantee)} guarantee`
        : `The ${contract(basis.guarantee)} guarantee beats the ${basisPointsToPercent(basis.basisPoints)}% door share`;
    default:
      return "A paper agreement: nothing for the settlement to compute";
  }
}

/**
 * The DEAL's own total, in the agreement's currency with the reader's beside it — the same
 * rule `describeBasis`'s `contract` applies, for the other contract figure that shares the
 * sentence with it (QA7-24). "…60% of the deal's SEK 50,000" sat in the same breath as a
 * converted guarantee, so treating one and not the other would only move the mismatch.
 */
function dealTotalText(
  minorUnits: string,
  currency: string,
  convert: (minorUnits: string) => string,
): string {
  const own = formatMoney(minorUnits, currency);
  const shown = convert(minorUnits);
  return shown === own ? own : `${own} (${shown})`;
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
  /**
   * WHOSE CARD THIS IS — so the sentences stop saying "you" about somebody else
   * (QA sweep run 6, QA6-9).
   *
   * These captions were written for the reader's own card and were not person-aware.
   * The moment Full settlement access (#24.2) puts another party's card in front of
   * a reader, *"Plus the money you collected on the night — SEK 100,000"* appeared on
   * a performer's screen under the OPERATOR's name, telling them they had collected a
   * hundred thousand they never touched. Every figure was right; the pronoun was not.
   *
   * Defaulted to the reader's own card, which is what every existing caller means and
   * what the settlement PDF and the document view both render.
   */
  owner: { isYours: boolean; name: string } = { isYours: true, name: "" },
): EntitlementRule[] {
  const rules: EntitlementRule[] = [];
  /** The possessive of the party's name, or of "you" on the reader's own card. The
   * nominative form moved to `payoutAdjustments` with the cash rows that used it. */
  const whose = owner.isYours ? "your" : possessiveOf(owner.name || "that party");
  /** The same possessive where it OPENS a caption rather than sitting inside one. */
  const sentenceStart = `${whose.charAt(0).toUpperCase()}${whose.slice(1)}`;

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
        ? // "the deal's" and not a bare figure: on a 60/40 bill both acts saw the
          // identical sentence ending in the SAME total, which reads as each of them
          // being paid it. The number belongs to the agreement; the line beside it is
          // what this party takes out of it.
          //
          // And the party's OWN percentage when the engine recorded one. `describeBasis`
          // names the DEAL's rule — "100% of the adjusted net" — so without this both
          // acts on a 60/40 were told they got 100% of the same SEK 50,000 while being
          // paid 30,000 and 20,000 (QA sweep, 2026-09-27). A settlement snapshotted
          // before the engine carried it says "your share" as it always did, which is
          // true and vague rather than precise and wrong.
          `${describeBasis(line.basis, currency, formatAmount)} — ${
            line.partyBasisPoints != null
              ? `${whose} ${basisPointsToPercent(line.partyBasisPoints)}% of`
              : `${whose} share of`
          } the deal's ${dealTotalText(line.dealTotal, currency, formatAmount)}`
        : describeBasis(line.basis, currency, formatAmount),
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
      /*
       * WHOSE SHARE, AND HOW MUCH OF IT — because two co-operators read this same sentence over two
       * different numbers (QA sweep run 9 QA9-7, restated as QA10-6).
       *
       * Measured on one screen at a 25/75 split: The Lantern Hall's card said *"What is left after
       * every other party is paid — SEK 7,875"* and Northlight's said the same words over
       * **SEK 23,625**. "What is left" is a single quantity (SEK 31,500) and neither card said it was
       * being divided. At 50/50 both read SEK 15,750 and the wording is accidentally true, which is
       * why it read as correct for four sweeps.
       *
       * The same sentence, the same bug and the same fix as `partyBasisPoints` on a shared deal line
       * twenty lines above — down to the fallback: a settlement snapshotted before the engine
       * recorded the share says "your share", which is true and vague rather than precise and wrong,
       * and a solo operator says it too, a share of one being nothing to name.
       */
      label: `${sentenceStart} ${
        computed.residualBasisPoints != null
          ? `${basisPointsToPercent(computed.residualBasisPoints)}% of`
          : "share of"
      } what is left after every other party is paid`,
      value: formatAmount(computed.residual),
    });
  }
  /*
   * CASH IS NOT ENTITLEMENT, and a `collected` row here was the eighth instance this
   * stretch of a comment asserting a rule the code does not keep (QA8-5).
   *
   * Run 6 added one, on the stated belief that *"the engine's `entitlement` is `deal
   * lines + revenue you collected − costs fronted for you`"*. `reconcile.ts:348-369`
   * says otherwise, in three lines: `entitlement = owed` (the allocation alone),
   * `held = collected − paid + prepaid`, `net = owed − held`. Cash never enters the
   * allocation.
   *
   * It nevertheless appeared to make the column sum, and the reason is worth keeping:
   * `reconcile.ts:255` credits a NON-POOLED line's collector with what they kept, so a
   * performer holding their own merch line has that amount in `entitlement` AND in
   * `collected`. For an operator collecting POOLED door revenue it is cash to pay out,
   * outside the allocation entirely — SEK 20,700 of entitlement over a row of 78,000.
   * Right for one party kind by coincidence, wrong for the other by construction.
   *
   * The cash rows live in `payoutAdjustments` below, under the divider QA7-10 opened
   * for exactly this: things that explain the gap between the entitlement and what
   * moves.
   */
  if (computed.deductibles != null && computed.deductibles !== "0") {
    rules.push({
      key: "deductibles",
      label: `Less costs somebody else fronted on ${owner.isYours ? "your" : whose} behalf`,
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

/** One rung of the waterfall, already formatted. */
export interface LadderRow {
  key: string;
  label: string;
  /** The design's small grey line under the label, saying what the row is. */
  caption: string;
  value: string;
  /** Money coming OFF the running figure — rendered as a subtraction. */
  negative?: boolean;
  /** The figure every percentage is a share of — rendered as the emphatic rung. */
  total?: boolean;
}

/**
 * THE WATERFALL — gross revenue down to the figure every percentage divides.
 *
 * The rows, the order and the captions are Ran's Overview card
 * (`claude-prototype/ran-2026-09-10/renders/proto-settlement-overview.png`), and
 * since 2026-09-15 the engine computes exactly this chain, so nothing here is a
 * translation: each row is a field, and each row is the one above it less one
 * thing. Formats; never computes.
 *
 * **It also answers a question that was asked.** Ran, on ClickUp `86cbcn1ue`:
 * *"what does 'Pool' mean?"* — the word was a bare noun among plain descriptions.
 * The waterfall retires it here without a rename debate, because a row that reads
 * "Net revenue · after deductions" sitting between the two rows it is the
 * difference of does not need defining. The other "pool" strings on the deal
 * screens are left exactly as they are; that vocabulary is the terminology
 * session's call, not a guess to make on the way past.
 *
 * OPERATOR ONLY, and the caller does not choose: the route serves `ladder: null`
 * to anyone without `budget.view` (story.md:44), so a party who may not read the
 * night's takings has nothing here to format.
 */
export function ladderRows(
  ladder: PoolLadder,
  currency: string,
  /** Converting formatter when the reader is previewing another currency. */
  formatAmount: (minorUnits: string) => string = (minorUnits) => formatMoney(minorUnits, currency),
): LadderRow[] {
  return [
    {
      key: "revenue",
      label: "Gross revenue",
      caption: "all sources",
      value: formatAmount(ladder.revenue),
    },
    /*
     * THE ONE ROW THE DESIGN DOES NOT HAVE, and it is drawn only when it is not
     * zero — which on Ran's own demo night, and on most nights, it is.
     *
     * A venue running its own bar collected money the event never pooled (#23.2).
     * The design has no notion of that, so a five-row chain would silently fail to
     * add up the moment it happens: gross minus deductions would not be the net.
     * Drawing the row when there is something in it keeps the arithmetic visible
     * and leaves the common case looking exactly like the design.
     */
    ...(ladder.attributed !== "0"
      ? [
          {
            key: "attributed",
            label: "Collected by others",
            caption: "kept by the party that took it",
            value: formatAmount(ladder.attributed),
            negative: true,
          },
        ]
      : []),
    {
      key: "costs",
      label: "Deductions",
      caption: "fees, tax, refunds, production",
      value: formatAmount(ladder.costs),
      negative: true,
    },
    {
      key: "net-revenue",
      label: "Net revenue",
      caption: "after deductions",
      value: formatAmount(ladder.netRevenue),
    },
    /*
     * The rental row, drawn only when a rental exists — same rule as `attributed`
     * and for the same reason: a live-looking row pinned at zero teaches a reader
     * something untrue about the night. On an event with no room hire the chain
     * ends one row early and the adjusted net equals the net revenue, which is the
     * truth rather than a hidden step.
     */
    ...(ladder.offTheTop !== "0"
      ? [
          {
            key: "off-the-top",
            label: "Venue rental",
            caption: "paid off the top",
            value: formatAmount(ladder.offTheTop),
            negative: true,
          },
        ]
      : []),
    {
      key: "adjusted-net",
      label: "Adjusted net",
      caption: "what percentages divide",
      value: formatAmount(ladder.adjustedNet),
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
  /** Money that has actually moved — `paid`, and nothing else. */
  paid: string;
  /** Under review right now: sent for review, commented on, or revised. */
  inReview: string;
  /** Everything not yet paid, whatever stage it is at. */
  outstanding: string;
  /** Figures locked and frozen with their FX rate — whether or not paid. */
  finalized: string;
}

/**
 * The rows a filter chip and a search box leave standing (ClickUp `123qy9rngbp`).
 *
 * FILTERED IN THE BROWSER, and only here. `GET /settlements` takes no cursor and
 * answers with every settlement the caller is a party to, so the browser really
 * does hold the whole list — unlike the Events list, which pages and therefore
 * searches on the server.
 *
 * A DATE IS MATCHED AS IT IS WRITTEN ON THE SCREEN, as well as raw. Somebody
 * looking for a May show types "May", or "8 May", or the year — none of which
 * appear in `2026-05-08`. Matching both spellings is the difference between a
 * search box that works and one that only works for people who know the storage
 * format.
 *
 * Exported and pure so it can be asserted: it is the whole of this screen's
 * filtering, and a wrong answer here renders a shorter list, which looks exactly
 * like a correct list of somebody with fewer shows.
 */
export function matchingSettlements<
  Row extends { status: string; event: { title: string; eventDate: string | null } },
>(rows: Row[], filter: string, search: string): Row[] {
  const term = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.status !== filter) return false;
    if (term === "") return true;
    const haystack = [
      row.event.title,
      row.event.eventDate ?? "",
      row.event.eventDate ? formatDay(row.event.eventDate) : "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

/**
 * Sum the caller's entitlements by status.
 *
 * `entitlement` is null until the event has been computed — a real "not yet" — so
 * those rows are skipped rather than counted as zero. With no rows at all every
 * figure is an em dash: nothing has settled, and "0" would assert a total that was
 * never calculated.
 */
/**
 * WHAT "SETTLED" MEANT, AND WHY THE TILE READ ZERO (QA sweep run 2, r2:880).
 *
 * Measured on every account kind: `TOTAL SETTLED SEK 0` next to `FINALIZED SEK 20,700`.
 * Both were true — `settled` counted `paid` alone, and nothing had been paid — but in
 * this domain "settled" is what a finalized settlement IS, so the card read as broken
 * arithmetic rather than as two different facts. The tile is now called what it counts:
 * **Paid**.
 *
 * The second half of the same finding: a row whose own chip said **Open** was counted
 * under a tile labelled **Pending review**, because `open` was bucketed with
 * `comments_received`. A settlement nobody has sent out is not in review. It is
 * outstanding — which the Outstanding tile beside it already says — so `open` money is
 * counted there and nowhere else, and the review tile counts the three statuses the
 * review machine actually writes. A `dispute` stays out of it too: it is outstanding,
 * and calling an argument a review would flatter it.
 */
const IN_REVIEW_STATUSES = new Set(["pending_review", "comments_received", "revised"]);

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
    paid: format(sum((row) => row.status === "paid")),
    inReview: format(sum((row) => IN_REVIEW_STATUSES.has(row.status))),
    outstanding: format(sum((row) => row.status !== "paid")),
    finalized: format(sum((row) => row.status === "finalized")),
  };
}

/**
 * WHAT THE TOTAL PAYOUTS PANEL SAYS IT IS SHOWING — four cases, not three.
 *
 * The panel had a nested ternary whose first branch was *"As operator your share is retained;
 * below are the amounts payable to the other parties"*, fired by `isYours && net < 0`. A
 * co-operator with Full settlement access read it while collecting SEK 0, holding nothing, owing
 * SEK 12,000 IN, and paying nobody (QA sweep run 11).
 *
 * THE PREDICATE WAS A CONVERSE ERROR, and the comment above it stated the rule correctly:
 * *"Whoever is HOLDING the night's money has a negative net."* True — and the code tested the
 * other direction. Holding implies a negative net; a negative net does not imply holding. So
 * `retained` now asks the fact the sentence is actually about: did this reader take the money.
 *
 * The fourth case is the one that falls out of fixing the first. With `retained` false, the
 * co-operator hit *"What this event pays out, including your own share"* — also untrue, because
 * their share is not in the list; they are a payer. A list that is entirely other parties' money
 * needs its own sentence, and this is why the decision is a function: the same nesting hid two
 * wrong sentences from two different readers.
 */
export function payoutsCaption(input: {
  /** Did this reader collect cash on the night — the fact "retained" is about. */
  readerCollected: boolean;
  /** Is this reader's own net negative, so their share is not transferred to them. */
  readerOwesOut: boolean;
  /** Does the list contain a payout belonging to somebody else. */
  includesOthers: boolean;
  /** Does the list contain anything of the reader's own — a payout or their commission. */
  includesYours: boolean;
}): string {
  if (input.readerCollected && input.readerOwesOut) {
    return "As operator your share is retained; below are the amounts payable to the other parties.";
  }
  if (input.includesOthers && input.includesYours) {
    // An agent reading their client's settlement beside their own commission — the case that
    // exposed this branch in the first place.
    return "What this event pays out, including your own share.";
  }
  if (input.includesOthers) {
    return "What this event pays out to the other parties. Your own settlement is separate.";
  }
  return "What is payable to you on this event.";
}
