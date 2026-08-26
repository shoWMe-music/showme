import {
  type DealStructure,
  type SettlementBudgetLine,
  type SettlementDeal,
  type SettlementInput,
  type SettlementParticipant,
  type SettlementResult,
  assertBalanced,
  reconcile,
} from "@showme/settlement";

/**
 * The reference concluded event's money — ONE definition, used both to INSERT the
 * budget/deal rows and to DERIVE the settlement snapshot stored beside them.
 *
 * Audit A-13 is what two definitions cost. The seeds hand-wrote the figures, and
 * the hand arithmetic took 70% of **gross revenue** where the engine takes 70% of
 * the **pool** (revenue − external costs) — so the platform's own reference
 * settlement was 6 300.00 SEK away from what the engine would pay, and every screen
 * built against it was reading a lie. Numbers a human types beside data they
 * describe drift from the code that computes them; numbers the engine produces
 * cannot.
 *
 * So nothing here states a result. It states the *terms and the cash*, and calls
 * `reconcile()` — the same function `POST /events/:id/settlement/compute` calls —
 * to say what they come to. Change a budget line and the snapshot follows.
 */

/** Every amount below is minor units (öre) of this currency. */
export const REFERENCE_EVENT_CURRENCY = "SEK";

// ── The fixture's calendar ───────────────────────────────────────────────────
/**
 * WHEN the reference events happen — as offsets from the day the seed runs, not as
 * dates.
 *
 * This lives beside the money because the money's *meaning* depends on it. A
 * finalized settlement only makes sense on an event that has happened; a budget is a
 * PROJECTION only on one that has not. Both seeds used to hard-code absolute dates
 * with a comment reading "today ≈ 2026-08-09", and the calendar rotted straight past
 * them: "Open Mic Wednesdays" — seeded as a DRAFT of an upcoming night — sat six days
 * in the past, and the confirmed album release was seventeen days from expiring the
 * same way. When it did, the Financial Projections screen's "Upcoming" tab would have
 * gone back to showing nothing, which is the bug this fixture was fixed to stop
 * telling.
 *
 * So the pipeline is stated as a SHAPE — one settled show behind us, four dates ahead
 * of us — and the shape is true whenever the seed is run. The cost is that a seeded
 * date is no longer a constant a test may hard-code; nothing does, and nothing should:
 * assert the shape (past/future, ordering) instead.
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` date `offsetInDays` from today. The anchor is the LOCAL calendar day
 * (what the developer running the seed calls "today"); the arithmetic is then done in
 * UTC so a daylight-saving boundary cannot shift the result by a day.
 */
export function dateOffsetFromToday(offsetInDays: number): string {
  const today = new Date();
  const anchor = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(anchor + offsetInDays * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The operator's pipeline, in days from today. Both seeds build the same five events,
 * so the shape is stated once: one concluded show far enough back that its settlement
 * reads as history, then a near draft, a confirmed headline show, a hold further out,
 * and a cancelled date at the far end.
 */
export const REFERENCE_EVENT_DAY_OFFSETS = {
  springWarmup: -130, // concluded — the settled reference event
  openMic: 7, // draft — next week's instalment of a weekly night
  albumRelease: 17, // confirmed — the event the projections must project
  synthShowcase: 67, // on_hold — a pencilled date being costed out
  winterGala: 101, // cancelled — kept so the cancelled state has a row
} as const;

/** The same five offsets resolved against today, ready to store in `events.event_date`. */
export function referenceEventDates(): Record<keyof typeof REFERENCE_EVENT_DAY_OFFSETS, string> {
  return {
    springWarmup: dateOffsetFromToday(REFERENCE_EVENT_DAY_OFFSETS.springWarmup),
    openMic: dateOffsetFromToday(REFERENCE_EVENT_DAY_OFFSETS.openMic),
    albumRelease: dateOffsetFromToday(REFERENCE_EVENT_DAY_OFFSETS.albumRelease),
    synthShowcase: dateOffsetFromToday(REFERENCE_EVENT_DAY_OFFSETS.synthShowcase),
    winterGala: dateOffsetFromToday(REFERENCE_EVENT_DAY_OFFSETS.winterGala),
  };
}

/**
 * The signed guarantee-vs-door terms of the concluded event. `splitBasisPoints` is a
 * share of the POOL, not of gross revenue — `deals.split_basis_points` means the same
 * thing everywhere, and the engine's `dealEntitlement` reads it that way.
 */
export const REFERENCE_GUARANTEE_VS_DOOR_TERMS = {
  structure: "guarantee_vs_door",
  guaranteeAmount: 1_800_000n, // 18 000.00 SEK floor
  splitBasisPoints: 7_000, // 70.00% of the pool
} as const;

/**
 * The shared door split of the upcoming album release — two performers on ONE deal.
 *
 * **The distinction this constant exists to hold on to:** `deals.split_basis_points`
 * SIZES the deal (what the payees take out of the pool, together), while each
 * `deal_parties.share.splitBasisPoints` only DIVIDES that between them. They are not
 * the same number and one cannot stand in for the other. The seeded fixture stated
 * only the party weights and left the deal-level column NULL, so `dealEntitlement`
 * computed `applyBasisPoints(pool, 0)` — the deal took nothing out of the pool, both
 * performers settled at zero, and the venue kept the lot. That is the residue A-01
 * flagged and A-13 owns: *"the seeded 'Door Split' deal has split_basis_points = NULL,
 * so it takes 0% of the pool and pays nobody"*.
 *
 * The split members take the WHOLE pool between them (10000 bp) and divide it 60/40 —
 * which is the signed snapshot A-01 records: on a 50 000.00 pool, Marlo Vance
 * 30 000.00 and Neon Tide 20 000.00, the two per-party amounts below.
 */
export const REFERENCE_DOOR_SPLIT_TERMS = {
  structure: "door_split",
  /** 100.00% — the deal-level column the ENGINE reads to size the entitlement. */
  splitBasisPoints: 10_000,
} as const;

/**
 * How the two split members divide that entitlement between themselves — weights, not
 * sizes (see above). The per-line amounts are what each share comes to at the reference
 * 50 000.00 pool and nothing more: they are ILLUSTRATIVE, not floors. Audit A-36 settled
 * that question — a floor is the deal-level `guarantee_vs_door` structure, which the
 * engine settles as max(guarantee, door); a floor inside a `door_split` would break the
 * rule that split members divide 100% of the pool. At a 20 000.00 door the headliner is
 * owed 12 000.00, not 30 000.00, and that is correct.
 *
 * Illustrative no longer means unverified, though. The seeds now put a real budget on
 * the album release (`referenceAlbumReleaseBudgetLines`) sized so that its pool IS
 * `REFERENCE_DOOR_SPLIT_POOL` — so on the event the seeds actually insert, these two
 * amounts are what the deal pays, and the agent's commission below is 10% of a figure
 * the engine will confirm rather than of a number nobody could check.
 */
export const REFERENCE_DOOR_SPLIT_SHARES = {
  headlinerBasisPoints: 6_000, // Marlo Vance — 60.00%
  supportBasisPoints: 4_000, // Neon Tide — 40.00%
  headlinerAmount: 3_000_000n, // 30 000.00 SEK at the reference pool
  supportAmount: 2_000_000n, // 20 000.00 SEK at the reference pool
} as const;

/** The reference pool the door split's signed per-line amounts are quoted at. */
export const REFERENCE_DOOR_SPLIT_POOL = 5_000_000n; // 50 000.00 SEK

/**
 * The dev seed's flat guarantee on the upcoming album release — one payee, no split.
 * A guarantee is sized by `deals.guarantee_amount`, so that column is the one that
 * must not be null here.
 */
export const REFERENCE_GUARANTEE_TERMS = {
  structure: "guarantee",
  guaranteeAmount: 2_500_000n, // 25 000.00 SEK
} as const;

/**
 * Every deal the seeds insert, reduced to the DEAL-LEVEL terms `dealEntitlement`
 * reads. A deal missing from this list, or listed with nothing in it, is inert: it
 * pays its payees nothing however their `share` jsonb divides it. The guard test
 * walks this list and refuses a deal that sizes to zero out of a real pool.
 */
export const REFERENCE_DEALS = [
  { label: "Spring Warm-up — guarantee vs door", terms: REFERENCE_GUARANTEE_VS_DOOR_TERMS },
  { label: "Album Release — door split", terms: REFERENCE_DOOR_SPLIT_TERMS },
  { label: "Album Release — flat guarantee (dev seed)", terms: REFERENCE_GUARANTEE_TERMS },
] as const;

/** The ids a seed brings — each seed names its own rows; the economics are shared. */
export interface ReferenceEventSpine {
  /** The operator's `event_participants` row: collects the door, fronts the costs. */
  hostParticipantId: string;
  /** The performer's `event_participants` row: the deal's payee. */
  performerParticipantId: string;
  /** The guarantee-vs-door deal the door revenue belongs to. */
  dealId: string;
}

/** A budget line as the seeds insert it, minus the ids only the seed knows. */
export interface ReferenceBudgetLine {
  kind: "revenue" | "cost";
  label: string;
  amount: bigint;
  currency: string;
  collectedBy?: string;
  paidBy?: string;
  payeeParticipantId?: string;
  dealId?: string;
}

/**
 * The three external-cash lines of the reference event.
 *
 * Note which cost is which: "Sound & production" has no `payeeParticipantId`, so it
 * is an EXTERNAL cost and lowers the pool. "Artist hotel" names the performer, so it
 * is a DEDUCTIBLE — it leaves the pool alone and comes off that performer's
 * entitlement instead. Getting those two backwards is the whole of A-13.
 */
export function referenceBudgetLines(spine: ReferenceEventSpine): ReferenceBudgetLine[] {
  return [
    {
      kind: "revenue",
      label: "Ticket sales (312 @ 250 SEK)",
      amount: 7_800_000n, // 78 000.00 SEK door, collected by the operator
      currency: REFERENCE_EVENT_CURRENCY,
      collectedBy: spine.hostParticipantId,
      dealId: spine.dealId,
    },
    {
      kind: "cost",
      label: "Sound & production",
      amount: 900_000n, // 9 000.00 SEK to an external supplier, fronted by the operator
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Artist hotel",
      amount: 180_000n, // 1 800.00 SEK incurred FOR the performer — a deductible
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
      payeeParticipantId: spine.performerParticipantId,
    },
  ];
}

// ── The forward-looking budgets (what makes a projection projectable) ────────
/**
 * The ids a budget on an event that has NOT happened yet needs. A hold has no signed
 * deal, so `dealId` is optional — a revenue line may be booked without one.
 */
export interface ReferenceForwardLookingSpine {
  /** The operator's `event_participants` row: sells the tickets, fronts the costs. */
  hostParticipantId: string;
  /** The deal the door is being taken for, when one has been signed. */
  dealId?: string;
}

/**
 * The album release's shared budget — the fixture's forward-looking P&L.
 *
 * **What it is FOR.** Financial Projections exists to roll up "planned revenue vs.
 * planned costs across the pipeline", and it computes that from budget lines. The
 * seeds used to put a budget on exactly ONE event — the concluded one — so the
 * screen's "Confirmed" and "Upcoming" tabs both matched real events and had nothing
 * to sum over them, and rendered a dash. Nothing was broken; the fixture simply had
 * no data for the case the screen exists to show, which is indistinguishable from a
 * bug at the point where a user is looking at it.
 *
 * **Why the numbers are these numbers.** Revenue less external costs is the POOL, and
 * this event's deal is a `door_split` taking 100% of the pool, divided 60/40. Sizing
 * the budget so the pool lands exactly on `REFERENCE_DOOR_SPLIT_POOL` is what turns
 * the deal's quoted per-party lines (30 000.00 / 20 000.00) and the agent commission
 * derived from them (3 000.00) from figures written beside the data into figures the
 * engine produces from it:
 *
 *   revenue  65 000 advance + 18 000 walk-up                       = 83 000
 *   costs    12 000 production + 9 000 marketing + 8 500 security
 *            + 3 500 catering                                      = 33 000
 *   pool     83 000 − 33 000                                       = 50 000
 *
 * **Why there is no bar or merchandise revenue here.** The pool is Σ revenue − Σ
 * external costs over EVERY budget line on the event, whatever its scope — so a bar
 * takings line would be swept into a pool the split members take 100% of, and the
 * venue would hand its bar over to the artists. "Artists split the net door, the venue
 * keeps the bar" is the deal being modelled; the bar staying off this budget is what
 * models it.
 *
 * **Why no line names a performer.** A cost carrying `payeeParticipantId` is a
 * DEDUCTIBLE against that party (the concluded event's hotel line demonstrates that
 * one). Every cost here is owed to an outside supplier, so every one of them lowers
 * the pool instead — and the two performers settle at exactly their signed shares.
 */
export function referenceAlbumReleaseBudgetLines(
  spine: ReferenceForwardLookingSpine,
): ReferenceBudgetLine[] {
  return [
    {
      kind: "revenue",
      label: "Advance ticket sales (260 @ 250 SEK)",
      amount: 6_500_000n, // 65 000.00 SEK, collected by the operator
      currency: REFERENCE_EVENT_CURRENCY,
      collectedBy: spine.hostParticipantId,
      dealId: spine.dealId,
    },
    {
      kind: "revenue",
      label: "Walk-up ticket sales (60 @ 300 SEK)",
      amount: 1_800_000n, // 18 000.00 SEK on the night, same collector
      currency: REFERENCE_EVENT_CURRENCY,
      collectedBy: spine.hostParticipantId,
      dealId: spine.dealId,
    },
    {
      kind: "cost",
      label: "Sound & production",
      amount: 1_200_000n, // 12 000.00 SEK — PA, backline, engineer call
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Marketing & print",
      amount: 900_000n, // 9 000.00 SEK — posters, ads, tickets
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Door & security staffing",
      amount: 850_000n, // 8 500.00 SEK to the security firm
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Green-room catering",
      amount: 350_000n, // 3 500.00 SEK to the caterer — an outside supplier, so a
      currency: REFERENCE_EVENT_CURRENCY, // pool cost, NOT a deductible on the artist
      paidBy: spine.hostParticipantId,
    },
  ];
}

/**
 * The hold's budget — the venue costing out a pencilled date before it confirms it.
 *
 * **What it is FOR.** "Upcoming" is a wider net than "Confirmed", and a pipeline whose
 * only forward budget sat on the one confirmed show would let the screen's
 * partial-coverage path ("2 of 3 events budgeted") go unexercised — and would leave an
 * operator's most common real question, *is this hold worth confirming?*, with no data
 * behind it. Deciding that is what a hold budget is for.
 *
 * **Why it is PRIVATE.** Nothing is signed on a hold, so there is no counterparty to
 * share a budget with; the figures are the venue's own margin working, and
 * `budgets.scope = 'private'` is the column that says so (visible only to the profile
 * that owns it). It is also the fixture's only private budget, so the visibility rule
 * that hides one operator's margin from a co-promoter finally has a row behind it.
 *
 * Every figure is an estimate and says so in its label, because that is what it is.
 */
export function referenceHoldBudgetLines(
  spine: ReferenceForwardLookingSpine,
): ReferenceBudgetLine[] {
  return [
    {
      kind: "revenue",
      label: "Projected ticket sales (220 @ 250 SEK)",
      amount: 5_500_000n, // 55 000.00 SEK if the hold converts and sells as modelled
      currency: REFERENCE_EVENT_CURRENCY,
      collectedBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Sound & production (estimate)",
      amount: 1_100_000n, // 11 000.00 SEK
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Marketing & print (estimate)",
      amount: 750_000n, // 7 500.00 SEK
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Door & security staffing (estimate)",
      amount: 600_000n, // 6 000.00 SEK
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
  ];
}

/** Stand-in ids for asking a question of the TERMS alone, before any seed's rows exist. */
const STAND_IN_SPINE: ReferenceForwardLookingSpine = {
  hostParticipantId: "reference-host",
  dealId: "reference-deal",
};

/**
 * Every budget the seeds attach to an event that has not happened yet — the exact set
 * the Financial Projections screen sums.
 *
 * This is the `REFERENCE_DEALS` idea applied to the failure one level up. That list
 * guards a deal that sizes to nothing out of a real pool; this one guards a
 * forward-looking event that projects nothing at all, which is the shape the reported
 * bug actually had: not a wrong figure but an absent one, showing as a dash the user
 * has to guess the meaning of. The guard test walks this list and refuses a budget
 * with no revenue to project.
 */
export const REFERENCE_FORWARD_LOOKING_BUDGETS = [
  {
    label: "Album Release — shared door budget (confirmed, upcoming)",
    lines: referenceAlbumReleaseBudgetLines(STAND_IN_SPINE),
  },
  {
    label: "Nordic Synth Showcase — the venue's private hold costing (on_hold, upcoming)",
    lines: referenceHoldBudgetLines(STAND_IN_SPINE),
  },
] as const;

/**
 * Revenue, cost and profit over a budget the way the Financial Projections screen sums
 * it: every revenue line against every cost line, with no view of who a cost was for.
 * The screen's own arithmetic, restated here so a guard can ask what the screen will
 * show. Note it is NOT the pool — a deductible is a cost to this sum and not to the
 * pool — so the two answers agree only on a budget with no deductibles on it.
 */
export function projectedProfit(lines: readonly ReferenceBudgetLine[]): {
  revenue: bigint;
  cost: bigint;
  profit: bigint;
} {
  let revenue = 0n;
  let cost = 0n;
  for (const line of lines) {
    if (line.kind === "revenue") revenue += line.amount;
    else cost += line.amount;
  }
  return { revenue, cost, profit: revenue - cost };
}

/** The reference event as the settlement engine sees it — the same view the API builds. */
export function referenceSettlementInput(spine: ReferenceEventSpine): SettlementInput {
  const participants: SettlementParticipant[] = [
    { participantId: spine.hostParticipantId, isOperator: true },
    { participantId: spine.performerParticipantId },
  ];

  const deal: SettlementDeal = {
    dealId: spine.dealId,
    structure: REFERENCE_GUARANTEE_VS_DOOR_TERMS.structure,
    payeeParticipantIds: [spine.performerParticipantId],
    guaranteeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount,
    splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
  };

  const budgetLines: SettlementBudgetLine[] = referenceBudgetLines(spine).map((line) => ({
    kind: line.kind,
    amount: line.amount,
    collectedBy: line.collectedBy,
    paidBy: line.paidBy,
    payeeParticipantId: line.payeeParticipantId,
  }));

  return {
    baseCurrency: REFERENCE_EVENT_CURRENCY,
    participants,
    deals: [deal],
    budgetLines,
  };
}

/**
 * Reconcile the reference event. What it comes to, in SEK:
 *
 *   pool        = 78 000 revenue − 9 000 external cost            = 69 000
 *   performer   = max(18 000 guarantee, 70% × 69 000 = 48 300)    = 48 300
 *                 less the 1 800 hotel deductible                 = 46 500
 *   operator    = residual 69 000 − 48 300 = 20 700
 *   held        = operator 78 000 − 10 800 = 67 200 · performer 0
 *   net         = operator 20 700 − 67 200 = −46 500 · performer +46 500   (Σ = 0)
 *   transfer    = operator → performer 46 500
 *
 * Those numbers are here to be read, not to be trusted — `reconcile()` produces the
 * ones that are stored, and `assertBalanced` refuses to hand back books that do not
 * balance.
 */
export function referenceSettlement(spine: ReferenceEventSpine): SettlementResult {
  const result = reconcile(referenceSettlementInput(spine));
  assertBalanced(result);
  return result;
}

/** One party's line out of a reconciliation. Throws if the party is not in it. */
export function breakdownFor(
  result: SettlementResult,
  participantId: string,
): SettlementResult["breakdowns"][number] {
  const breakdown = result.breakdowns.find((row) => row.participantId === participantId);
  if (!breakdown) {
    throw new Error(`No settlement breakdown for participant ${participantId}`);
  }
  return breakdown;
}

/**
 * One reference deal's terms as the ENGINE sees them, with a stand-in payee — the
 * shape `dealEntitlement` is handed when `POST /settlement/compute` maps the DB rows.
 * Used by the guard test to ask each seeded deal the only question that matters
 * before anyone's `share` weights get involved: out of a real pool, does this deal
 * size to anything at all?
 */
export function dealTermsAsTheEngineSeesThem(terms: {
  structure: DealStructure;
  guaranteeAmount?: bigint;
  splitBasisPoints?: number;
}): SettlementDeal {
  return {
    dealId: "reference-deal",
    structure: terms.structure,
    payeeParticipantIds: ["reference-payee"],
    guaranteeAmount: terms.guaranteeAmount,
    splitBasisPoints: terms.splitBasisPoints,
  };
}
