import { type Database, schema } from "@showme/db";
import { isTicketRevenueBasis, majorToMinor } from "@showme/shared";
import { and, eq, sql } from "drizzle-orm";

/**
 * TAKING THE SETTLEMENT'S COPY OF THE BUDGET — once, and once only.
 *
 * The rule this exists to keep (the product owner, 2026-08-27): *"The settlement
 * has a copy of the budget. The budget is never changed from the settlement."*
 * A budget is a forecast and goes on being a planning document; a settlement is
 * the record of what actually happened. `reconcile()` reads the copy, the planner
 * keeps its own rows, and neither can overwrite the other.
 *
 * **Sealed.** The copy is taken the first time a settlement is run and never
 * consults the budget again — the owner's choice among the drift behaviours. A
 * budget edited afterwards is a forecast being revised after the fact and has no
 * standing over a night that already happened. Which is why this returns early on
 * the second call rather than reconciling the two sides: a "refresh" would throw
 * away the actuals somebody typed, and that is the whole feature.
 *
 * An event with no budget at all copies nothing and settles on its deals alone,
 * which is a legitimate night — a guarantee with no costs recorded anywhere.
 *
 * **SERIALIZED PER EVENT, and it has to be.** "Have we copied yet?" followed by
 * "then copy" is two statements, and between them another compute can run the
 * same pair — so two callers both saw no lines and both copied the whole budget.
 * Every revenue and cost line then existed twice, which doubles the pool and
 * changes what every party is paid, silently, with no error anywhere.
 *
 * Found by three Playwright tests hitting "Run the settlement" in parallel
 * against one event: the Overview reported **960 tickets sold** on a night that
 * sold 320, and the ledger balanced perfectly around the wrong number — Σ net = 0
 * validates the distribution, never the total. In production the same shape is
 * two co-operators clicking at once, or one impatient double-click.
 *
 * A transaction-scoped advisory lock rather than a unique index: the constraint
 * that would express this (one settlement line per origin budget line) cannot be
 * written without a migration, and lines added later carry no origin at all. The
 * lock is keyed on the event, so two different events still settle concurrently.
 */
export async function ensureSettlementLines(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: Database | any,
  eventId: string,
): Promise<{ copied: number; alreadyHad: boolean }> {
  return await database.transaction(
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx handle.
    (tx: any) => copyBudgetOnce(tx, eventId),
  );
}

async function copyBudgetOnce(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx handle.
  database: any,
  eventId: string,
): Promise<{ copied: number; alreadyHad: boolean }> {
  // Held until this transaction ends, so the check and the copy below cannot be
  // interleaved with another compute of the SAME event. `hashtextextended` gives
  // the bigint the lock function wants from a uuid.
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}::text, 0))`);

  const existing = await database
    .select({ id: schema.settlementLines.id })
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId))
    .limit(1);
  if (existing.length > 0) return { copied: 0, alreadyHad: true };

  // ONLY THE SHARED BUDGET. With a co-host, the shared budget is the one that
  // becomes the settlement; a co-promoter's `private` budget is their own margin
  // — internal accounting, not part of the night's reconciliation — and never
  // enters it. That is also what keeps it unreadable: a line that was never
  // copied cannot leak through the settlement to the other party, and there is
  // no per-line privacy rule to get wrong later.
  let budgetLines = await database
    .select()
    .from(schema.budgetLines)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
    .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));

  // THE FORECAST THE PLANNER IS SHOWING BUT HAS NOT WRITTEN (ClickUp 123qy9rnwud).
  //
  // Ticket tiers are entered on EVENT DETAILS and live in `events.extras`. The
  // Budget Planner SEEDS them into its form (`useBudgetSeed`) and — deliberately —
  // only persists a seeded figure once the operator has touched it, because a
  // flush that wrote every untouched row used to invent phantom lines nobody
  // entered. So an operator who fills in tickets on Event Details, opens the
  // planner and reads a correct forecast off it has NOTHING in `budget_lines`.
  //
  // The two rules are each right and together left a hole: the screen showed a
  // SEK 2.8M door while "Start from the Budget Planner" copied zero lines,
  // reported success, and settled the night on the guarantee floor. Measured
  // 2026-09-21 reproducing Ran's report: 0 settlement lines, pool 0, and a
  // performer entitled to the SEK 3,000 guarantee instead of 70% of SEK 400,000.
  //
  // Pressing that button IS the acceptance the planner's own rule waits for — the
  // operator is asking for the forecast — so the tiers are materialised here as
  // real budget lines and then copied by the code below. They become budget rows
  // rather than settlement rows on purpose: planned-vs-actual pairs on
  // `origin_budget_line_id`, so seeding only the settlement would still have left
  // the planned column empty.
  // NO DOOR, rather than NO LINES — the fix's own gap, closed 2026-09-22.
  //
  // This asked whether the budget was EMPTY, which closed the reported case and
  // left the commoner one open. The planner writes a row the moment the operator
  // TOUCHES it, and the first thing most of them touch is a cost: they type a
  // production figure, never touch the ticket rows they can already see filled in
  // from Event Details, and the budget is no longer empty. The seeding then did
  // not fire, the copy took the cost and nothing else, and the night settled with
  // COSTS AND NO REVENUE — a negative pool, every percentage deal paying zero, and
  // the act back on the guarantee floor. The same symptom Ran reported, reached by
  // a shorter road.
  //
  // PER TIER, rather than per budget — the second half of the same gap, closed
  // 2026-09-26.
  //
  // This asked whether the budget stated A door and skipped the seeding entirely
  // if it did. One ticket row was read as "the operator has stated the whole
  // night's takings". The planner writes PER ROW — only the tier the operator
  // touched — so on an event with two tiers, editing one wrote one line and that
  // line alone satisfied this gate: the other tier was never materialised and the
  // night settled without it. Measured on `Open Mic Wednesdays`: a SEK 6,300 door
  // settled at SEK 1,800, the missing SEK 4,800 being the row nobody had typed in
  // because it was already correct on the screen.
  //
  // So the question is asked of each tier, not of the sheet — but only where the
  // sheet is speaking in tiers at all.
  //
  // TWO KINDS OF DOOR ROW, and they cannot be matched the same way. A row the
  // planner wrote from a tier carries `details.basis = "ticket_tier"` and keeps the
  // tier's name as its label, so it can be paired with the tier it came from. A row
  // somebody typed themselves — "Door, as actually counted", no `details` at all —
  // is the whole night's takings under a name of the operator's choosing, and
  // pairing it by name against `General` would find no match and materialise the
  // tiers on top of it, DOUBLING the door. That is the double-count the previous
  // rule existed to prevent, and it stays prevented: one unstructured ticket row
  // and the sheet is stating its own door in its own terms, untouched.
  const ticketRows = budgetLines.filter(
    (row: { budget_lines: typeof schema.budgetLines.$inferSelect }) =>
      row.budget_lines.kind === "revenue" && isTicketRevenueBasis(row.budget_lines.details),
  );
  const statesItsOwnDoor = ticketRows.some(
    (row: { budget_lines: typeof schema.budgetLines.$inferSelect }) =>
      (row.budget_lines.details as { basis?: string } | null)?.basis !== "ticket_tier",
  );
  if (!statesItsOwnDoor) {
    const stated = new Set<string>();
    for (const row of ticketRows as {
      budget_lines: typeof schema.budgetLines.$inferSelect;
    }[]) {
      const tierId = (row.budget_lines.details as { tierId?: string } | null)?.tierId;
      if (tierId != null) stated.add(`id:${tierId}`);
      stated.add(`name:${row.budget_lines.label.trim().toLowerCase()}`);
    }
    const seeded = await seedTicketTiersIntoBudget(database, eventId, stated);
    if (seeded > 0) {
      budgetLines = await database
        .select()
        .from(schema.budgetLines)
        .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
        .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));
    }
  }
  if (budgetLines.length === 0) return { copied: 0, alreadyHad: false };

  await database.insert(schema.settlementLines).values(
    budgetLines.map((row: { budget_lines: typeof schema.budgetLines.$inferSelect }) => {
      const line = row.budget_lines;
      return {
        eventId,
        // What this was budgeted at is a question about a specific forecast line,
        // so the copy remembers which one. Planned-vs-actual pairs on it.
        originBudgetLineId: line.id,
        kind: line.kind,
        source: line.source,
        providerRef: line.providerRef,
        label: line.label,
        amount: line.amount,
        currency: line.currency,
        collectedBy: line.collectedBy,
        paidBy: line.paidBy,
        payeeParticipantId: line.payeeParticipantId,
        costSplit: line.costSplit,
        // A share agreed while planning has to survive into what settles (#23.2),
        // the same way the cost rule beside it does.
        revenueShares: line.revenueShares,
        details: line.details,
        dealId: line.dealId,
        attributedDealId: line.attributedDealId,
      };
    }),
  );
  return { copied: budgetLines.length, alreadyHad: false };
}

/**
 * One ticket tier as Event Details stores it (`events.extras.ticketTiers`).
 *
 * `price` is in MAJOR units and the schema says so — "display-only; settlement
 * money lives in budget lines". Every money column this file writes is MINOR, so
 * the conversion below is not a detail: reading the tier price as minor units
 * settles a SEK 2,000 ticket at SEK 20 and pays the act a hundredth of the door.
 */
interface EventTicketTier {
  /** Stable per-event id, written by the Event Details editor. */
  id?: string;
  name?: string;
  /** Major-unit unit price. */
  price?: number;
  /** Expected sales; `max` is the tier's inventory cap, used when est is absent. */
  est?: number;
  max?: number;
}

/**
 * Write the event's ticket tiers into the shared budget as revenue lines.
 *
 * The shape matches exactly what the planner writes when the operator edits a
 * tier by hand (`useBudgetEditor`): `kind: "revenue"`, the tier's name as the
 * label, `amount = unitAmount x quantity` computed in MINOR units so the total
 * always equals its own breakdown, and `details.basis = "ticket_tier"` — which is
 * what `routes/settlement.ts` reads to decide that a revenue line is the DOOR
 * rather than bar or merchandise. Getting that wrong would leave the tickets out
 * of the percentage a door deal is measured against.
 *
 * Returns how many were written, so a genuinely empty forecast stays distinct
 * from one that was seeded.
 */
async function seedTicketTiersIntoBudget(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx handle.
  database: any,
  eventId: string,
  /**
   * What the budget ALREADY states, as `id:<tierId>` and `name:<lowercased label>`
   * keys. Both are carried because a line written before `details.tierId` existed
   * can only be matched by name, and a renamed tier can only be matched by id.
   * The planner's own merge (`mergeTicketTierSeeds`) matches the same two ways,
   * deliberately — the sheet and the settlement have to agree about which tiers
   * are spoken for, or one of them double-counts.
   */
  alreadyStated: ReadonlySet<string> = new Set(),
): Promise<number> {
  const [event] = await database
    .select({ extras: schema.events.extras, baseCurrency: schema.events.baseCurrency })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  const all = (event?.extras as { ticketTiers?: EventTicketTier[] } | null)?.ticketTiers;
  if (!Array.isArray(all) || all.length === 0) return 0;
  const tiers = all.filter((tier) => {
    // The tier's own id where the line carries one, the name only for lines
    // written before `details.tierId` existed. A rename moves the name and keeps
    // the id, which is the whole reason the id is now stored.
    if (tier.id != null && alreadyStated.has(`id:${tier.id}`)) return false;
    return !alreadyStated.has(`name:${(tier.name ?? "").trim().toLowerCase() || "ticket tier"}`);
  });
  if (tiers.length === 0) return 0;

  const currency = event?.baseCurrency ?? "EUR";
  const rows = tiers
    .map((tier) => {
      // `majorToMinor`, not a hardcoded x100: the planner multiplies by 100
      // inline, which is wrong for a zero-decimal currency like JPY. The shared
      // helper reads the currency's exponent.
      const unitAmount = majorToMinor(tier.price ?? 0, currency);
      const quantity = BigInt(Math.trunc(tier.est ?? tier.max ?? 0) || 0);
      // Unit x count in minor units, so `amount` always equals its own
      // breakdown — the same reason the planner multiplies before converting.
      return { tier, unitAmount, quantity, amount: unitAmount * quantity };
    })
    // A tier with no price or no expected sales forecasts nothing. Writing a
    // zero row would put an empty line in the ledger the settlement reconciles.
    .filter((row) => row.amount > 0n);
  if (rows.length === 0) return 0;

  // The host does the planning and collects the door unless somebody says
  // otherwise — the same fallback the planner's own flush applies to a tier that
  // has not been attributed.
  const [host] = await database
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .where(
      and(eq(schema.eventParticipants.eventId, eventId), eq(schema.eventParticipants.role, "host")),
    );

  // `budgets` has NO currency column — a budget line carries its own, defaulting
  // to the event's base. Typechecking did not catch the invented column because
  // this function takes an untyped Drizzle handle; the test that inserts a budget
  // for real did.
  let [budget] = await database
    .select({ id: schema.budgets.id })
    .from(schema.budgets)
    .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));
  if (!budget) {
    [budget] = await database
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning({ id: schema.budgets.id });
  }
  if (!budget) return 0;

  await database.insert(schema.budgetLines).values(
    rows.map(({ tier, unitAmount, quantity, amount }) => ({
      budgetId: budget.id,
      kind: "revenue" as const,
      label: (tier.name ?? "").trim() || "Ticket tier",
      // `amount` is a bigint column (minor units, money.md) — passed as a BigInt,
      // not a string.
      amount,
      currency,
      collectedBy: host?.id ?? null,
      details: {
        basis: "ticket_tier" as const,
        unitAmount: unitAmount.toString(),
        quantity: Number(quantity),
        // So a later rename in the planner cannot make this row look like a
        // different tier and get the event's one materialised beside it.
        ...(tier.id != null ? { tierId: tier.id } : {}),
      },
    })),
  );
  return rows.length;
}
