import {
  type BreakEvenChart,
  type BreakdownRow,
  type PerformingRightsFeeEstimate,
  type PerformingRightsTerritory,
  computeBreakEvenChart,
  computeBreakdown,
  computeBudgetProjection,
  dealFigureDisagreement,
  estimatePerformingRightsFee,
} from "@showme/shared";
import { formatMoney, formatMoneyExact, minorUnitsPer } from "../lib/format";
import { toMinorUnits } from "../lib/moneyUnits";
import type { KpiItem, KpiTone } from "./KpiRow";
import { type BudgetEditor, budgetInputsFrom, minorUnitsOf } from "./useBudgetEditor";
import type { TicketSplitRaw } from "./useBudgetSeed";

/**
 * Everything the Budget Planner draws, derived once from the editor's draft.
 *
 * The screen renders this and computes none of it (CLAUDE.md): the arithmetic is
 * `@showme/shared`'s, and the only work done here is the unit boundary — minor
 * units as bigint on one side, formatted strings on the other. Keeping it in a
 * plain function rather than inside the component means the eight sections cannot
 * drift apart: they are all reading the same projection, and there is one place
 * to look when a figure disagrees with the one above it.
 */

/** The palette the design prototype uses for the two breakdown lists. */
const REVENUE_COLORS = {
  tickets: "#EE5746",
  bar: "#F4A046",
  merch: "#B58BE0",
  other: "#6FA8E0",
} as const;
const COST_COLORS = ["#EE5746", "#F4A046", "#6FA8E0", "#B58BE0", "#6FC97A", "#8C7A6C"] as const;
/** Custom revenue rows cycle their own colours, so a budget with several of them
 * keeps getting distinguishable bars rather than three identical blues. */
const CUSTOM_REVENUE_COLORS = ["#B58BE0", "#6FC97A", "#8C7A6C", "#E0A9C6"] as const;
const PROCESSING_COLOR = "#E6D9CB";

export interface BreakdownDisplayRow {
  label: string;
  /** The share this row prints — a fact about the money. */
  percentLabel: string;
  amountLabel: string;
  /** How wide to draw the bar: this row against the biggest one. */
  barPercent: number;
  /**
   * This row's share of the TOTAL, as a number — the donut's arc.
   *
   * Deliberately not `barPercent`, which is this row against the LARGEST row so
   * the biggest bar always fills its track. A ring drawn from that would not close
   * and its slices would not be comparable: the same 83% would sweep the whole
   * circle whether it was 83% of the night or all of it.
   */
  sharePercent: number;
  color: string;
}

export interface BreakEvenDisplay {
  chart: BreakEvenChart;
  /** The money scale, formatted here so the currency peek reaches the chart too. */
  gridLabels: { y: number; label: string }[];
  breakEvenLabel: string;
  capacityLabel: string;
}

export interface PerformingRightsDisplay {
  feeLabel: string;
  rateLabel: string;
  /**
   * Whether a rate configured for this event's territory produced the figure, or
   * the flat planning default did. The card leans on this for everything it says
   * about confidence — see `PerformingRightsEstimateCard`.
   */
  isTerritoryTariff: boolean;
  /** The pill: the society and territory when there is one, "Estimate only" when not. */
  sourceLabel: string;
  /** The published tariff the rate was read off, when an admin recorded one. */
  sourceUrl: string | null;
  /** Stated in full on the card — even a real tariff produces only an estimate here. */
  assumptions: string[];
}

/**
 * A cost row that claims to be a deal's own figure while stating a different one.
 *
 * Carried as finished TEXT because the component that draws it renders and does
 * not compute (CLAUDE.md): the integer comparison is `@showme/shared`'s
 * `dealFigureDisagreement`, the money formatting is this module's unit boundary,
 * and the row is handed the two figures it prints.
 */
export interface DealFigureWarning {
  /** The deal whose figure the row claims to be. */
  dealName: string;
  /** What the planner is forecasting, formatted. */
  plannedLabel: string;
  /** What the settlement will use, formatted. */
  dealLabel: string;
}

export interface BudgetPlannerView {
  kpis: KpiItem[];
  results: KpiItem[];
  /**
   * Why the profit figures are absent, when they are — null whenever this reader
   * can see every deal on the night. See `costsIncomplete`.
   */
  costsIncompleteNote: string | null;
  ticketRevenueTotal: string;
  /**
   * Each tier's own `price × quantity`, formatted, keyed by tier id — the TOTAL
   * column the new design gives every ticket row.
   *
   * Derived here rather than in the component, which takes values and emits
   * events (CLAUDE.md's review gate). It also has to be derived from the same
   * inputs the projection uses, or the column and the band under it would be two
   * opinions about one figure.
   */
  ticketTierTotals: Record<string, string>;
  /** "1,280 tickets planned across all types" — the totals band's subtitle. */
  ticketsPlannedLabel: string;
  /** How the door divides, ready to render. Empty when no percentage deal applies. */
  ticketSplit: TicketSplitDisplay;
  barRevenue: string;
  merchRevenue: string;
  /**
   * The break-even chart, or **null for a reader whose costs are incomplete**.
   *
   * Null rather than a chart with the crossing point removed, because the whole
   * picture is wrong for them and not just its caption: the cost line itself is
   * drawn from a partial total. See the note beside `costsIncomplete` for the
   * measurement that made this a defect (QA sweep run 4, QA4-5).
   */
  breakEven: BreakEvenDisplay | null;
  revenueSources: BreakdownDisplayRow[];
  costBreakdown: BreakdownDisplayRow[];
  performingRights: PerformingRightsDisplay;
  /** Keyed by cost row key — only rows that actually disagree appear here. */
  dealFigureWarnings: Record<string, DealFigureWarning>;
}

/**
 * A cost row, only as much of one as the partition below needs to look at.
 *
 * Structurally identical to `CostRow` in `BudgetPlanner`, and deliberately not
 * imported from it: this module is the pure view layer and must not depend on the
 * component that renders it.
 */
export interface PartitionableCostRow {
  label: string;
  value: string;
  isCustom?: boolean;
  readFromDeal?: { dealNames: string[] };
}

/**
 * THE SIX STANDING HEADINGS, SPLIT INTO THE ONES THIS SHOW ACTUALLY USES.
 *
 * Reported 2026-08-31: the planner is "too big" and has "no delete buttons".
 * Both halves are the same row. `STANDARD_COST_HEADINGS` puts Performer fee,
 * Production, Staff, Marketing, Venue and Other on every budget whether or not
 * the operator uses them, each one carrying a money field, three attribution
 * selects and a note — six rows of chrome for a show that might have two real
 * costs. They were made un-removable on purpose (`useBudgetEditor`: *"deleting
 * 'Performer fee' would take a heading out of a screen that is supposed to always
 * show the same six, and the operator would have no way to get it back"*), and
 * that reasoning is still right: **removal is the wrong verb, and it is not what
 * gets chosen here.**
 *
 * What gets chosen is that an unused heading is not a row yet. That is already
 * true of the data — a heading only becomes a `budget_lines` row once it is given
 * a figure — so the screen is simply catching up with the model it sits on. An
 * unused heading collapses into a chip that puts it back with one click, so
 * nothing is lost and nothing is unreachable.
 *
 * **THE SETTLEMENT MATHS CANNOT MOVE EITHER WAY.** A heading with no figure has
 * no line; `ensureSettlementLines` copies `budget_lines`, and a row that was never
 * written is not in that table. Hiding it changes nothing that `reconcile()` can
 * read, so `Σ net = 0` is untouched by construction rather than by argument.
 *
 * A heading stays visible the moment it has a figure, is read from a deal (the
 * performer fee), or the operator has asked for it back this session.
 *
 * **Revealed headings are tracked by LABEL, not by row key.** A standing
 * heading's key changes underneath it — `new:Staff cost` until it is given a
 * figure, the `budget_lines` id afterwards, and back to `new:` when the line is
 * cleared. Keyed by that, a heading revealed, filled and then cleared came back
 * as a blank row nobody had asked for, because the set still held a key the row
 * no longer had. The label is the one thing about a standing heading that does
 * not move.
 */
/**
 * THE THREE HEADLINE FIGURES HAVE TO ADD UP (QA sweep run 2, r2:480).
 *
 * Measured: `TOTAL REVENUE SEK 6,300 · TOTAL COSTS SEK 4,805 · PROFIT / LOSS SEK
 * 1,496`. Every one of those roundings is individually correct — costs are 480,450
 * minor (4,804.50) and the profit 149,550 (1,495.50), both half-up — and the card
 * still fails the one check a reader actually performs on it. Two correct numbers and
 * a third that contradicts them reads as a broken screen, not as rounding.
 *
 * So the difference shown is the difference of the figures shown: round the two
 * components to the unit the card prints, then subtract. The engine keeps its exact
 * arithmetic — break-even, the margin and the settlement are untouched — and only the
 * three numbers standing next to each other are made to agree.
 */
export function roundToDisplayUnit(minor: bigint, minorUnits: number): bigint {
  const unit = BigInt(Math.max(1, Math.round(minorUnits)));
  if (unit === 1n) return minor;
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const rounded = ((magnitude + unit / 2n) / unit) * unit;
  return negative ? -rounded : rounded;
}

/**
 * A RENAMED HEADING KEEPS ITS PLACE ON THE SHEET (QA sweep run 3, r3:178).
 *
 * Reveals are tracked by LABEL — see `splitCostRows` for why the row's key cannot
 * carry them — which means a heading revealed as "Other" and then NAMED stopped being
 * revealed on the first keystroke. Measured: the row left the cost table mid-edit and
 * came back as a chip under its new name. Typing the amount first kept it, because a
 * figure makes the reveal irrelevant.
 *
 * So a rename moves the reveal with it. Nothing is written — a heading with no figure
 * still has no line — and the row is created the moment it is given one, under the
 * name the operator typed, which is what `changeCostLabel` already documents.
 */
export function carryRevealedHeading(
  revealed: readonly string[],
  from: string,
  to: string,
): string[] {
  if (!revealed.includes(from)) return [...revealed];
  return revealed.map((heading) => (heading === from ? to : heading));
}

export function splitCostRows<Row extends PartitionableCostRow>(
  costs: Row[],
  revealedHeadings: readonly string[],
): { budgeted: Row[]; unused: Row[] } {
  const revealed = new Set(revealedHeadings);
  const budgeted: Row[] = [];
  const unused: Row[] = [];
  for (const cost of costs) {
    const isUnusedHeading =
      !cost.isCustom && !cost.readFromDeal && cost.value.trim() === "" && !revealed.has(cost.label);
    (isUnusedHeading ? unused : budgeted).push(cost);
  }
  return { budgeted, unused };
}

/**
 * @param territory Where the show happens and what PRO rate is configured there,
 *   from `GET /events/:id/performing-rights-rate`. Omitted (or still loading) the
 *   planner falls back to the flat planning estimate and SAYS SO on the card,
 *   which is the same thing it did before any tariff table existed.
 */
/** One bar on the "How ticket revenue splits" block. */
export interface TicketSplitRow {
  key: string;
  name: string;
  /**
   * What this party IS on the event — "Performer", "Co-host", "Venue".
   *
   * The design names every line this way and it is the difference between "Marlo
   * Vance 60%" and "Marlo Vance · Performer 60%": the first is a number beside a
   * name, the second says why that party is owed it. Read from the participant's
   * event role, never inferred from the deal — a deal tells you what someone is
   * paid, not what they are here to do.
   */
  roleLabel: string | null;
  /**
   * "70%" — the share of the door, for the chip beside the name. NULL when a claim
   * exceeds the door: a guarantee paid on a short night is not a proportion of it,
   * and printing one gave a party 111% of a quantity.
   */
  percentLabel: string | null;
  /** Bar width as a percentage of the widest bar on the card. */
  widthPercent: number;
  amount: string;
  color: string;
  /** The operators' line is a remainder, not a deal — said plainly on the row. */
  isRemainder?: boolean;
  /** That remainder is NEGATIVE: the door does not cover what the deals claim. */
  isShortfall?: boolean;
}

export interface TicketSplitDisplay {
  rows: TicketSplitRow[];
  badge: string | null;
  /**
   * The whole split in one line — "70% performer / 20% promoter / 10% venue".
   *
   * Composed from the rows being drawn, so it can never disagree with them, and
   * by ROLE where the roles tell the parties apart. Two performers on one bill
   * would give "60% performer / 40% performer", which names nothing, so the line
   * falls back to the parties' own names the moment a role repeats.
   */
  composition: string | null;
  summary: string | null;
  /**
   * WHAT THIS CARD IS A SHARE OF, and what the deal actually pays.
   *
   * The card divides the BOX OFFICE — `door.ticketRevenue`, before costs and before
   * rental — which is the design's own choice and is captioned as such on the
   * settlement screen. The planner had no such caption, so a reader took its figure
   * as the act's money: measured 2026-09-26 on Open Mic, the card said Marlo Vance
   * took SEK 4,410 (70% of the 6,300 gross) while the Costs row one card below and
   * the settlement one click away both paid SEK 3,710 (70% of the 5,300 adjusted
   * net) — 18.9% overstated, on one screen at one moment, with nothing to say why.
   *
   * Null when there is nothing to qualify: no derived fee to compare against.
   */
  payoutCaption: string | null;
  /** Nothing to draw: no percentage deal, or no door yet. */
  isEmpty: boolean;
}

/**
 * The split bars, named and formatted.
 *
 * COLOURS ARE POSITIONAL, not semantic: these are shares of one figure, and none
 * of them is good or bad. Borrowing the green/red the rest of this screen uses for
 * profit and loss would say something about a performer's cut that is not true.
 */
const SPLIT_COLORS = ["#F4A046", "#6FC97A", "#6FA8E0", "#C77E1E", "#FF7A68"];

export function ticketSplitDisplay(
  raw: TicketSplitRaw,
  participants: { id: string; label: string; roleLabel?: string }[],
  money: (amount: bigint) => string,
  /** What the deal will actually pay — see `payoutCaption`. Absent when unknown. */
  feePayableMinor?: bigint | null,
): TicketSplitDisplay {
  if (raw.doorMinor <= 0n || raw.shares.length === 0) {
    return {
      rows: [],
      badge: null,
      composition: null,
      summary: null,
      payoutCaption: null,
      isEmpty: true,
    };
  }
  const partyOf = (id: string) => participants.find((party) => party.id === id);
  const nameOf = (id: string) => partyOf(id)?.label ?? "A collaborator";
  const share = (amount: bigint) => Number((amount * 10_000n) / raw.doorMinor) / 100;

  /**
   * A SHARE CARD IS A DIVISION OF ONE QUANTITY, and a guarantee is not a share.
   *
   * On a guarantee-vs-door night whose takings fall short, the engine pays the
   * guarantee — which can exceed the whole door. Expressed as a proportion of the
   * door that is a percentage over 100, and the card printed it: "111% performer",
   * one bar, and NO operator row, because the remainder was negative and the row was
   * only drawn when it was positive. So the screen hid the one fact the operator
   * most needed (this night loses money on the door) behind an arithmetic
   * impossibility. Measured 2026-09-26: guarantee SEK 2,000 against SEK 1,800 of
   * tickets.
   *
   * When a claim exceeds the door, percentages are dropped rather than printed
   * wrong — the amounts are exact and the summary beneath already explains that the
   * guarantee beat the door. Bars stay drawn, scaled against the largest claim so
   * the shortfall is visible as a shape.
   */
  const claimedMinor = raw.shares.reduce((running, line) => running + line.amountMinor, 0n);
  const overClaimed = claimedMinor > raw.doorMinor;
  const widestMinor = claimedMinor > raw.doorMinor ? claimedMinor : raw.doorMinor;
  const width = (amount: bigint) =>
    widestMinor > 0n ? Number((amount * 10_000n) / widestMinor) / 100 : 0;

  const rows: TicketSplitRow[] = raw.shares.map((line, index) => ({
    key: line.participantId,
    name: nameOf(line.participantId),
    roleLabel: partyOf(line.participantId)?.roleLabel ?? null,
    percentLabel: overClaimed ? null : `${Math.round(line.basisPoints / 100)}%`,
    widthPercent: width(line.amountMinor),
    amount: money(line.amountMinor),
    color: SPLIT_COLORS[index % SPLIT_COLORS.length] as string,
  }));

  // NON-ZERO, not positive. A deal taking the whole door — the seeded album release
  // does exactly that at 100% — draws no row, because a zero-width bar labelled
  // "the operators" reads as an error rather than as nothing. A NEGATIVE remainder
  // is the opposite of nothing: it is the operator paying out more than the door
  // took, and leaving it off the card was how "111% performer" came to be the whole
  // story.
  if (raw.operatorRemainderMinor !== 0n) {
    const negative = raw.operatorRemainderMinor < 0n;
    const magnitude = negative ? -raw.operatorRemainderMinor : raw.operatorRemainderMinor;
    rows.push({
      key: "operators",
      name: "The operators",
      // No role: this line is nobody in particular, it is what no deal claimed.
      roleLabel: null,
      percentLabel: overClaimed ? null : `${Math.round(share(raw.operatorRemainderMinor))}%`,
      widthPercent: width(magnitude),
      amount: money(raw.operatorRemainderMinor),
      color: SPLIT_COLORS[rows.length % SPLIT_COLORS.length] as string,
      isRemainder: true,
      ...(negative ? { isShortfall: true } : {}),
    });
  }

  const roles = rows.map((row) => row.roleLabel);
  const rolesTellThemApart =
    roles.every((role) => role !== null) && new Set(roles).size === roles.length;
  // No percentages to compose with when the guarantee governs — the headline then
  // names the amounts, which are the only true figures on the card.
  const composition = rows
    .map((row) => {
      const who = rolesTellThemApart ? (row.roleLabel as string).toLowerCase() : row.name;
      return `${row.percentLabel ?? row.amount} ${who}`;
    })
    .join(" / ");

  /*
   * The design's own words for what this card is ("box office only, before costs and
   * rental"), plus the figure that is actually paid when the two differ — because the
   * gap is the whole reason the caption is needed, and a reader should not have to
   * find the Costs card to learn of it.
   */
  const claimed = raw.shares.reduce((running, line) => running + line.amountMinor, 0n);
  const payoutCaption =
    feePayableMinor != null && claimed > 0n
      ? feePayableMinor === claimed
        ? "Box office only, before costs and rental."
        : `Box office only, before costs and rental — after them the deal pays ${money(feePayableMinor)}.`
      : null;

  return {
    rows,
    badge: raw.badge,
    composition,
    summary: raw.summary,
    payoutCaption,
    isEmpty: false,
  };
}

/**
 * WHY THE PROFIT FIGURES ARE MISSING, in the reader's own terms — or null when
 * nothing is missing.
 *
 * A plain function so it can be asserted without standing up a whole
 * `BudgetEditor` (the reason the rest of this module is untested here), and so the
 * singular case reads like English rather than "1 deals are".
 */
/**
 * The total of the cost rows whose figure is read from a deal, or null when none is.
 *
 * Null and not zero: "no deal states a fee" and "the deal states nothing" are
 * different answers, and only the first should silence the caption.
 */
function derivedFeeMinor(editor: BudgetEditor): bigint | null {
  const derived = editor.costs.filter((cost) => cost.readFromDeal != null);
  if (derived.length === 0) return null;
  return derived.reduce((running, cost) => running + minorUnitsOf(cost.value), 0n);
}

/**
 * ONE CONDITION, so two parts of the screen cannot disagree about it.
 *
 * They did (QA sweep run 4, QA4-5). The KPI tiles were withheld off
 * `editor.hiddenDealCount > 0` written inline, the note came from
 * `costsIncompleteNoteFor` written separately, and the break-even chart consulted
 * neither — so the screen said *"break-even is left out rather than calculated
 * without it"* and drew a break-even directly underneath. Both readers of the rule
 * now call this, and `budgetPlannerView.test.ts` asserts they agree.
 */
/**
 * WHAT THE BREAK-EVEN TILE READS, given the chart's answer about this room.
 *
 * Exported, like the other decisions in this module, because it is the part that can be wrong:
 * `budgetPlannerViewFrom` takes a whole `BudgetEditor` and this file's header explains why
 * standing one up to re-assert somebody else's arithmetic is not worth it. The arithmetic is
 * `@showme/shared`'s and tested there; the CHOICE between a number and a sentence is this
 * module's, and it was wrong (QA sweep run 11) — so it is a function rather than an expression
 * buried in a tile.
 */
/**
 * "640 TICKETS PLANNED ACROSS ALL TYPES" — IN A 400-CAPACITY ROOM (QA sweep run 11).
 *
 * The sheet said it, a `Venue capacity 400` field sat two rows below, the break-even chart was
 * captioned *"…inside 400 capacity"*, and nothing anywhere said the plan oversells the house.
 * Every per-guest figure divided by 640. `grep -rn "exceeds capacity"` across the web and shared
 * packages returned nothing: the planner had no concept of the room being full.
 *
 * Easy to reach, too, and not by fat-fingering: tiers entered on Event Details ADD rows to
 * whatever the planner already has, so two plausible sets of numbers make one impossible one.
 *
 * Said on the subtitle that already states the count rather than as a new banner — the reader is
 * looking at the figure when they need to know, and a warning somewhere else on a sheet this tall
 * is a warning they scroll past. Capacity of zero or less means "unset", not "an empty room", so
 * it says nothing at all there.
 */
export function ticketsPlannedLabelFor(ticketsSold: number, capacity: number): string {
  const counted = `${ticketsSold.toLocaleString()} ${ticketsSold === 1 ? "ticket" : "tickets"} planned across all types`;
  if (capacity > 0 && ticketsSold > capacity) {
    return `${counted} — more than the room's ${capacity.toLocaleString()} capacity`;
  }
  return counted;
}

export function breakEvenKpi(
  coverage: "on_chart" | "covered_before_doors" | "beyond_this_room",
  breakEvenTickets: number,
): number | string {
  // A crossing the room cannot reach is not a target; the chart beneath already says so.
  if (coverage === "beyond_this_room") return "No break-even";
  // …and zero here means "covered before the doors opened", which is QA5-7's ruling and the
  // one case where the figure 0 is a count rather than an absence.
  return breakEvenTickets;
}

export function costsAreIncomplete(hiddenDealCount: number, isPrivateBook = false): boolean {
  /*
   * …AND IT IS THE SHARED LEDGER'S CONDITION, not every book's (QA sweep run 9 QA9-5, restated as
   * QA10-11).
   *
   * A hidden deal means the NIGHT's costs are higher than this sheet can see, so a shared ledger must
   * not compute a profit from them — that is QA4-5 and it stands. A **private** book is a different
   * ledger: `PLAN.md:215` calls it *"the extra an operator MAY ALSO keep"*, its costs are the rows
   * its owner typed, and the performer fee on the shared ledger is not one of them. Withholding its
   * margin for a deal it never contained said something untrue of the page it was printed on: *"what
   * the night costs is higher than the total above"*, where "the total above" was the operator's own
   * SEK 4,000.
   *
   * The asymmetry is what proves it. The HOST's private book on the same event DOES print a margin,
   * because the host can see the deal and `hiddenDealCount` is 0 — so the only operator whose private
   * book could never show one was the co-promoter, which is the operator the private book exists for.
   */
  if (isPrivateBook) return false;
  return hiddenDealCount > 0;
}

export function costsIncompleteNoteFor(
  hiddenDealCount: number,
  isPrivateBook = false,
): string | null {
  if (!costsAreIncomplete(hiddenDealCount, isPrivateBook)) return null;
  const subject =
    hiddenDealCount === 1
      ? "One of this event's deals is"
      : `${hiddenDealCount} of this event's deals are`;
  const object = hiddenDealCount === 1 ? "it" : "them";
  return `${subject} not shown to you, so what the night costs is higher than the total above. Profit, margin and break-even are left out rather than calculated without ${object}.`;
}

export function budgetPlannerViewFrom(
  editor: BudgetEditor,
  currency: string,
  territory?: PerformingRightsTerritory,
  /**
   * How to render a figure — the ONE seam a currency peek needs.
   *
   * Every derived number on this screen is formatted by the `money` below, so
   * handing in `useCurrencyPreview`'s `format` converts the whole read-only half
   * of the planner at once: the KPI band, Results, break-even, both breakdowns
   * and the PRO estimate. Nothing else here changes, because nothing else here
   * knows what a currency is — the arithmetic is all in minor units and stays in
   * the event's own currency whatever is on screen.
   *
   * Omitted, figures format in `currency`, which is what every caller that is not
   * peeking wants and what this did before the peek existed.
   */
  formatFigure?: (minorUnits: string) => string,
): BudgetPlannerView {
  const inputs = budgetInputsFrom(editor);
  const projection = computeBudgetProjection(inputs);
  /**
   * A COST THIS READER CANNOT SEE MAKES EVERY COST-DERIVED FIGURE A FLOOR.
   *
   * The performer fee is derived from the deals list, and that list is scoped per
   * reader (story.md: an operator's breadth is emergent from being a party, never
   * god-mode; decisions.md #4 shares a deal with a co-host by making them a
   * `deal_party`). So a co-promoter who is not on the act's deal sees the shared
   * ledger minus that fee — and this screen used to total what it could see and
   * print `Profit / loss`, `Profit margin`, break-even and cost-per-guest off it.
   * Measured 2026-09-26: host SEK 1,245 LOSS, co-host SEK 40,255 PROFIT, same
   * ledger, same minute, neither marked.
   *
   * Total costs stays, labelled as partial, because a floor is still useful. The
   * figures that are only meaningful when costs are complete are withheld rather
   * than guessed — `costsIncompleteNote` says why, so a missing tile is never a
   * mystery. Revenue, the door and the ticket count are untouched: nothing about
   * them depends on a deal.
   */
  const costsIncomplete = costsAreIncomplete(editor.hiddenDealCount, editor.isPrivateBook);
  const money = (minor: bigint) =>
    formatFigure ? formatFigure(minor.toString()) : formatMoney(minor.toString(), currency);

  // The headline trio, made to agree with itself — see `roundToDisplayUnit` (r2:480).
  // Only these three: the margin, break-even and every per-guest figure stay on the
  // engine's exact arithmetic, and none of them is a subtraction a reader can check.
  const displayUnit = minorUnitsPer(currency);
  const shownRevenue = roundToDisplayUnit(projection.totalRevenue, displayUnit);
  const shownCosts = roundToDisplayUnit(projection.totalCosts, displayUnit);
  const shownProfit = shownRevenue - shownCosts;

  const chart = computeBreakEvenChart({
    projection,
    capacity: inputs.capacity,
    // Before any tier has a quantity there is no weighted average to slope the
    // line with, so the first price typed stands in for it.
    fallbackTicketPrice: inputs.ticketTiers[0]?.unitAmount ?? 0n,
  });

  const otherRevenue = BigInt(toMinorUnits(editor.otherRevenue));
  const revenueSources = computeBreakdown(
    [
      { label: "Ticket sales", amount: projection.ticketRevenue, color: REVENUE_COLORS.tickets },
      { label: "Bar / F&B", amount: projection.barRevenue, color: REVENUE_COLORS.bar },
      // Its own bar in the breakdown, not folded into the bar's. Seeing which of
      // the two a night's margin came from is the entire reason they were split.
      { label: "Merchandise", amount: projection.merchRevenue, color: REVENUE_COLORS.merch },
      { label: "Other", amount: otherRevenue, color: REVENUE_COLORS.other },
      // Each custom row under ITS OWN NAME, not folded into "Other". The whole
      // point of naming a field "Sponsorship" is to see the sponsorship in the
      // breakdown; a lump labelled "Other" answers a question nobody asked.
      ...editor.customRevenue.map((row, index) => ({
        label: row.label,
        amount: minorUnitsOf(row.value),
        color: CUSTOM_REVENUE_COLORS[index % CUSTOM_REVENUE_COLORS.length] ?? REVENUE_COLORS.other,
      })),
    ],
    projection.totalRevenue,
  );

  const costBreakdown = computeBreakdown(
    [
      ...editor.costs.map((cost, index) => ({
        label: cost.label,
        amount: minorUnitsOf(cost.value),
        // The headings cycle through the palette so a budget with custom rows of
        // its own keeps getting colours rather than running out.
        color: COST_COLORS[index % COST_COLORS.length] ?? PROCESSING_COLOR,
      })),
      {
        label: "Payment processing",
        amount: projection.paymentProcessingFees,
        color: PROCESSING_COLOR,
      },
    ],
    projection.totalCosts,
  );

  // Rows that say "this IS the deal's figure" and then state a different one.
  // Only a REAL disagreement lands here — same-value rows produce no entry — so
  // the screen renders whatever it is given and decides nothing.
  const dealFigureWarnings: Record<string, DealFigureWarning> = {};
  for (const cost of editor.costs) {
    const link = cost.dealLink;
    /**
     * TWO WAYS A ROW COMES TO DISAGREE WITH THE AGREEMENT, one sentence for both.
     *
     * `deal_figure` is the row that CLAIMS to be the deal's figure and states a
     * different one. `dealsSay` is the row that claims nothing and simply stands
     * where the deal's figure would have been read — the performer fee the
     * operator typed themselves, which outranks the deal on the screen and is
     * outranked by it at the settlement. Since the fee began reading from DRAFT
     * deals (`123qy9rnwud`), the second is the common one: the operator budgets
     * a fee, the offer is signed at another figure, and nothing said so.
     */
    const claimed =
      link?.kind === "deal_figure"
        ? editor.deals.find((option) => option.id === link.dealId)
        : undefined;
    let dealName: string;
    let stated: bigint | null;
    if (claimed) {
      dealName = claimed.name;
      stated = claimed.guaranteeAmount == null ? null : BigInt(claimed.guaranteeAmount);
    } else if (cost.dealsSay) {
      dealName = cost.dealsSay.dealName;
      stated = BigInt(cost.dealsSay.amountMinor);
    } else {
      continue;
    }
    const drift = dealFigureDisagreement(minorUnitsOf(cost.value), stated);
    if (!drift) continue;
    // Two amounts that differ by less than a whole unit round to the SAME text
    // under the screen's house format, and a warning reading "says SEK 3,000, but
    // says SEK 3,000" reads as a bug rather than as the sub-unit drift it is. When
    // the rounded labels collide, both figures are printed to the minor unit.
    const planned = money(drift.planned);
    const authoritative = money(drift.deal);
    const roundsToTheSameText = planned === authoritative;
    // The collision fallback stays in `currency` even during a currency peek, and
    // that is the right way round. It exists to be EXACT about two figures that
    // differ by less than a rounded unit, and the only place that difference is
    // real is the currency the money is actually in — restating it through a live
    // rate would mean disambiguating with a number that has its own rounding in
    // it. `formatMoneyExact` prints the symbol, so the sentence says which
    // currency it means.
    dealFigureWarnings[cost.key] = {
      dealName,
      plannedLabel: roundsToTheSameText
        ? formatMoneyExact(drift.planned.toString(), currency)
        : planned,
      dealLabel: roundsToTheSameText
        ? formatMoneyExact(drift.deal.toString(), currency)
        : authoritative,
    };
  }

  const performingRights = estimatePerformingRightsFee(projection.ticketRevenue, territory);

  return {
    kpis: [
      { label: "Total revenue", value: money(shownRevenue), tone: "green" },
      // TICKET REVENUE beside the total, because the two answer different
      // questions and #23.1 made the difference matter: the total is what the
      // night takes, the DOOR is what every percentage deal is a share of. An
      // operator checking an act's fee needs the second figure, and it was only
      // reachable by scrolling to the Revenue card and reading a band.
      { label: "Ticket revenue", value: money(projection.ticketRevenue), tone: "blue" },
      // AMBER, NOT RED. The design reserves red for a figure that is actually
      // bad, and a cost is not bad — it is what a show costs. Painting it the
      // same colour as a loss meant a profitable event still showed two red
      // figures out of five, which is the screen shouting at an operator who is
      // doing fine.
      {
        label: costsIncomplete ? "Total costs (partial)" : "Total costs",
        value: money(shownCosts),
        tone: "amber",
      },
      // A PROFIT IS NOT A FIGURE WHEN A COST IS MISSING. See `costsIncomplete`.
      ...(costsIncomplete
        ? []
        : [
            {
              label: "Profit / loss",
              value: money(shownProfit),
              tone: (projection.profit < 0n ? "red" : "green") as KpiTone,
            },
            // A COUNT, left plain. It is neither good nor bad until you know the
            // room, and the tile beside it already says whether the night makes
            // money.
            //
            // …AND "0" IS NOT A COUNT WHEN THERE IS NO CROSSING (QA sweep run 5,
            // QA5-7). The engine has said twice in its own docstrings that zero means
            // "no break-even" and that the screen renders it that way; the screen
            // rendered `0`, which reads as "you break even before selling a ticket" —
            // the opposite — directly above a chart captioned "Revenue never passes
            // total cost inside 420 capacity". `breakEvenReachable` is the engine
            // saying which of the two zeros this is.
            {
              label: "Break-even tickets",
              /*
               * …AND "REACHABLE" IS NOT THE SAME QUESTION AS "IN THIS ROOM" (QA sweep run 11).
               *
               * `breakEvenReachable` is `breakEvenTickets > 0 || uncovered <= 0`, and the scan
               * that produces those tickets runs to FOUR TIMES capacity so the figure is found
               * at all. So a 400-seat room whose costs cross at 407 printed **407** here,
               * directly above the chart's own caption *"Revenue never passes total cost inside
               * 400 capacity"*. Two definitions of reachable, one screen — and
               * `break-even-chart.ts` had warned about this exact reading in a comment.
               *
               * The chart's OWN ANSWER rather than a second call to the same predicate: the
               * chart is already computed above, and it normalises capacity (a zero falls back
               * to the planned tickets, then to an assumed room). Recomputing here would give
               * the two a way to part again, which is the whole defect.
               *
               * `covered_before_doors` still shows `0`, which is what QA5-7 established that
               * zero means when the standing revenue already pays the costs.
               */
              value: breakEvenKpi(chart.coverage, projection.breakEvenTickets),
            },
          ]),
    ],
    // TONED THE SAME WAY THE STRIP IS, which is what the design does and what we
    // did not: money carries its meaning (revenue green, the door blue, cost
    // amber, profit by its sign) and a COUNT OR A RATE stays plain. A margin
    // printed in green would be the third colour saying the same thing the
    // profit tile beside it already says, and "364 tickets" is neither good nor
    // bad until you know the room.
    results: [
      { label: "Total revenue", value: money(shownRevenue), tone: "green" },
      { label: "Ticket revenue", value: money(projection.ticketRevenue), tone: "blue" },
      {
        label: costsIncomplete ? "Total costs (partial)" : "Total costs",
        value: money(shownCosts),
        tone: "amber",
      },
      // EVERY FIGURE BELOW IS COST-DERIVED, so each one is withheld rather than
      // printed wrong when a deal is invisible to this reader (`costsIncomplete`).
      // Revenue, the door and the ticket count are unaffected and stay.
      ...(costsIncomplete
        ? []
        : [
            {
              label: "Profit / loss",
              value: money(shownProfit),
              tone: (projection.profit < 0n ? "red" : "green") as KpiTone,
            },
            // MARGIN BEFORE BREAK-EVEN, which is the design's order and the
            // reading order that follows from it: profit, then profit as a rate,
            // then the attendance that would make it zero. We had the last two the
            // other way round, so the row read profit, attendance, rate.
            {
              label: "Profit margin",
              /*
               * A MARGIN OF NOTHING IS NOT 0.0% (QA sweep run 7, QA7-26).
               *
               * `marginPercent` is `profit / revenue` and falls back to 0 where there is no
               * revenue to divide — which the strip then printed as a rate. Run 7 caught it
               * paired with a loss (`PROFIT MARGIN 0.0%` beside `PROFIT / LOSS −SEK 50,150`)
               * and QA7-3 removed that pairing by stopping the private book seeding itself;
               * an empty book now reads SEK 0 throughout, where 0.0% is merely unhelpful
               * rather than contradictory. It is still a claim about a rate that does not
               * exist, and `—` is what the app says everywhere else for "nothing to show".
               */
              value: projection.totalRevenue > 0n ? `${projection.marginPercent.toFixed(1)}%` : "—",
            },
            {
              label: "Break-even tickets",
              // See the KPI strip above: zero is two answers, and only the engine
              // knows which (QA5-7).
              value: projection.breakEvenReachable
                ? projection.breakEvenTickets.toLocaleString()
                : "No break-even",
            },
          ]),
      // What the sheet expects to SELL. The grid showed revenue and cost per
      // guest without ever saying how many guests it meant, so neither figure
      // could be checked.
      { label: "Tickets planned", value: projection.ticketsSold.toLocaleString() },
      {
        label: "Revenue / guest",
        // Null means nobody is planned, so there is no per-head anything — the same
        // answer `Profit margin` gives three rows up, and for the same reason (QA10-17).
        value: projection.revenuePerGuest == null ? "—" : money(projection.revenuePerGuest),
        tone: "green",
      },
      ...(costsIncomplete
        ? []
        : [
            {
              label: "Cost / guest",
              value: projection.costPerGuest == null ? "—" : money(projection.costPerGuest),
              tone: "amber" as KpiTone,
            },
          ]),
    ],
    costsIncompleteNote: costsIncompleteNoteFor(editor.hiddenDealCount, editor.isPrivateBook),
    ticketRevenueTotal: money(projection.ticketRevenue),
    ticketSplit: ticketSplitDisplay(
      editor.seedTicketSplit,
      editor.participants,
      money,
      // The Performer fee row when it is READ FROM A DEAL — the same figure the
      // settlement will pay, which is what makes the caption worth printing.
      derivedFeeMinor(editor),
    ),
    ticketsPlannedLabel: ticketsPlannedLabelFor(projection.ticketsSold, inputs.capacity),
    // Keyed by the EDITOR's row id, and taken from the same `inputs` the
    // projection reads, so the column and the band under it can never disagree.
    ticketTierTotals: Object.fromEntries(
      editor.ticketTiers.map((tier, index) => {
        const parsed = inputs.ticketTiers[index];
        return [
          tier.id,
          money(parsed ? parsed.unitAmount * BigInt(Math.trunc(parsed.quantity)) : 0n),
        ];
      }),
    ),
    barRevenue: money(projection.barRevenue),
    merchRevenue: money(projection.merchRevenue),
    /*
     * WITHHELD FOR THE SAME READER THE TILES ARE — QA sweep run 4, QA4-5.
     *
     * `costsIncomplete` already withholds Profit, Profit margin and Break-even
     * tickets, and the screen says so in its own words: *"Profit, margin and
     * break-even are left out rather than calculated without it."* The CHART was
     * drawn anyway, immediately under that sentence, with a marked crossing point
     * and a caption — *"Revenue passes total cost at 131 tickets of 400 capacity"* —
     * computed off a cost total the sweep measured at SEK 34,770 against the host's
     * SEK 119,770. The same night reads "Revenue never passes total cost inside 400
     * capacity" for the host. The co-promoter was handed a concrete, optimistic
     * break-even the app had just promised not to compute.
     *
     * Null, not a chart minus its caption: the cost LINE is the thing that is wrong,
     * so there is no honest version of this picture for a reader missing a fee.
     */
    breakEven: costsIncomplete
      ? null
      : {
          chart,
          gridLabels: chart.gridLines.map((line) => ({ y: line.y, label: money(line.amount) })),
          breakEvenLabel: `${chart.breakEvenTickets.toLocaleString()} tickets`,
          capacityLabel: chart.capacity.toLocaleString(),
        },
    revenueSources: revenueSources.map(displayRow(money)),
    costBreakdown: costBreakdown.map(displayRow(money)),
    performingRights: performingRightsDisplay(performingRights, money),
    dealFigureWarnings,
  };
}

/**
 * What the PRO card says, and the one place that decides how confident it sounds.
 *
 * The rule the whole feature turns on: a figure produced by the flat planning rate
 * must never be dressed as a tariff. So the two branches below differ in their
 * FIRST assumption line — the one that names where the rate came from — and the
 * shared lines are the ones that are true either way. An operator mistaking the
 * placeholder for a quote will under-budget a real invoice, which is the failure
 * this card exists to prevent.
 */
function performingRightsDisplay(
  estimate: PerformingRightsFeeEstimate,
  money: (minor: bigint) => string,
): PerformingRightsDisplay {
  const ratePercent = estimate.rateBasisPoints / 100;
  const shared = [
    "Charged on ticket revenue only; bar, merch and other revenue are outside it.",
    "Applies the rate to PROJECTED ticket revenue — the fee moves with what actually sells.",
  ];

  if (estimate.tariffSource === "territory_tariff") {
    const society = estimate.proName ?? "the local PRO";
    return {
      feeLabel: money(estimate.fee),
      rateLabel: `${ratePercent}% of ticket revenue`,
      isTerritoryTariff: true,
      sourceLabel: estimate.country ? `${society} · ${estimate.country}` : society,
      sourceUrl: estimate.sourceUrl,
      assumptions: [
        estimate.sourceNote
          ? `${ratePercent}% is the rate configured for ${estimate.country} — ${estimate.sourceNote}.`
          : `${ratePercent}% is the rate configured for ${estimate.country}. No tariff reference was recorded against it.`,
        ...shared,
        // Even a real, sourced rate is not a quote. shoWMe files nothing with any
        // society (`performance_reports` is unwritten), tariffs are negotiated per
        // venue, and they change yearly.
        `Still an estimate: shoWMe files nothing with ${society}, and the invoice follows their published tariff for this venue.`,
      ],
    };
  }

  return {
    feeLabel: money(estimate.fee),
    rateLabel: `≈ ${ratePercent}% of ticket revenue`,
    isTerritoryTariff: false,
    sourceLabel: "Estimate only",
    sourceUrl: null,
    assumptions: [
      estimate.country
        ? `Flat ${ratePercent}% planning rate — shoWMe has no tariff configured for ${estimate.country}.`
        : `Flat ${ratePercent}% planning rate — no territory tariff is configured in shoWMe.`,
      ...shared,
      estimate.country
        ? "No PRO is set for this event, so no published tariff was consulted."
        : "shoWMe could not tell where this show happens — set the venue's country and its PRO rate can be applied.",
    ],
  };
}

const displayRow =
  (money: (minor: bigint) => string) =>
  (row: BreakdownRow): BreakdownDisplayRow => ({
    label: row.label,
    amountLabel: money(row.amount),
    percentLabel: `${row.percentOfTotal}%`,
    barPercent: row.percentOfLargest,
    sharePercent: row.percentOfTotal,
    color: row.color,
  });
