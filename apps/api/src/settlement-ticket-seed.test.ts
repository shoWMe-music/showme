import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEventBudgets } from "./lib/budget-provisioning";
import { ensureSettlementLines } from "./lib/settlement-lines";

/**
 * THE FORECAST THE PLANNER SHOWS BUT HAS NOT WRITTEN (ClickUp 123qy9rnwud).
 *
 * Ran's report: "Start from the Budget Planner" shows a success toast and imports
 * nothing — revenue empty, costs empty, planned column zero, and the payout stuck
 * at the guarantee floor instead of the door.
 *
 * The cause is two individually-correct rules meeting. Ticket tiers are entered on
 * EVENT DETAILS and live in `events.extras`; the planner SEEDS them into its form
 * and only persists a seeded figure once the operator touches it (writing every
 * untouched row used to invent phantom lines). So a planner showing a correct
 * SEK 400,000 door had nothing in `budget_lines`, and the copy had nothing to take.
 *
 * Reproduced live before the fix: 0 settlement lines, pool 0, performer entitled to
 * the SEK 3,000 guarantee rather than 70% of SEK 400,000.
 */
let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});
afterAll(async () => {
  await harness?.stop();
});

/** An operator with one event, at the given base currency and ticket tiers. */
async function seedEvent(
  prefix: string,
  currency: string,
  ticketTiers: unknown[] | undefined,
): Promise<{ eventId: string; profileId: string }> {
  const { db } = harness;
  await db.insert(schema.users).values({ id: prefix, email: `${prefix}@t.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: prefix, name: prefix, slug: `${prefix}-p` })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: profile.id,
      title: `${prefix} show`,
      baseCurrency: currency,
      status: "confirmed",
      eventDate: "2027-06-10",
      createdBy: prefix,
      ...(ticketTiers ? { extras: { ticketTiers } } : {}),
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId: profile.id,
    role: "host",
    status: "confirmed",
  });
  return { eventId: event.id, profileId: profile.id };
}

/** `amount` is a bigint column, not a string — assert against BigInt literals. */
const linesOf = (eventId: string) =>
  harness.db
    .select()
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId));

describe("the door reaches the settlement even when the planner never wrote it", () => {
  it("materialises the event's ticket tiers and copies them", async () => {
    const { eventId } = await seedEvent("tiers", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);

    const result = await ensureSettlementLines(harness.db, eventId);
    expect(result.copied).toBe(1);

    const [line] = await linesOf(eventId);
    expect(line?.kind).toBe("revenue");
    expect(line?.label).toBe("General");
    // 200 tickets at SEK 2,000 = SEK 400,000 = 40,000,000 minor units.
    expect(line?.amount).toBe(40_000_000n);
    // `basis: ticket_tier` is what marks this revenue as THE DOOR — the figure a
    // percentage deal is measured against. Any other basis and a door split stops
    // seeing the tickets.
    expect((line?.details as { basis?: string })?.basis).toBe("ticket_tier");
    expect((line?.details as { unitAmount?: string })?.unitAmount).toBe("200000");
  });

  it("reads the tier price as MAJOR units, not minor", async () => {
    // The schema says so: "Major-unit price for this tier (display-only;
    // settlement money lives in budget lines)". Reading 2000 as minor units would
    // settle a SEK 2,000 ticket at SEK 20 and pay the act a hundredth of the door.
    const { eventId } = await seedEvent("major", "SEK", [
      { id: "t1", name: "GA", price: 100, max: 10, est: 10 },
    ]);
    await ensureSettlementLines(harness.db, eventId);
    const [line] = await linesOf(eventId);
    expect(line?.amount).toBe(100_000n); // 10 x SEK 100 = SEK 1,000
  });

  it("uses the currency's own exponent, so a zero-decimal currency is not inflated", async () => {
    // JPY has no minor unit. A hardcoded x100 (which the planner does inline)
    // would turn ¥3,000 into ¥300,000.
    const { eventId } = await seedEvent("jpy", "JPY", [
      { id: "t1", name: "GA", price: 3000, max: 10, est: 10 },
    ]);
    await ensureSettlementLines(harness.db, eventId);
    const [line] = await linesOf(eventId);
    expect(line?.amount).toBe(30_000n); // 10 x 3000, no cents
  });

  it("leaves a budget that states its own door completely alone", async () => {
    // A planner the operator has actually filled in is the source of truth, and
    // re-adding the event's tiers on top would double the night's takings.
    const { eventId } = await seedEvent("hasbudget", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: "Door, as actually counted",
      amount: 12_345n,
      currency: "SEK",
    });

    const result = await ensureSettlementLines(harness.db, eventId);
    expect(result.copied).toBe(1);
    const lines = await linesOf(eventId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.label).toBe("Door, as actually counted");
  });

  /**
   * THE SECOND HALF OF THE SAME GAP (QA sweep 2026-09-26, run 2, BLOCKER).
   *
   * The gate asked whether the budget stated A door and skipped the seeding
   * entirely if it did. But the planner writes PER ROW — only the tier the
   * operator touched — so on a two-tier event, editing one tier wrote one line,
   * and that line alone answered the question for the whole night. The other tier
   * was never materialised: a SEK 6,300 door settled at SEK 1,800.
   *
   * The tier rows the planner writes are structured (`basis: "ticket_tier"`, the
   * tier's name as the label), so they can be paired with the tier they came from.
   * The test above is the other kind — a door somebody typed under their own name,
   * which is the whole take and must never be supplemented.
   */
  it("materialises the tiers the planner has not written, beside the one it has", async () => {
    const { eventId } = await seedEvent("partialtiers", "SEK", [
      { id: "t1", name: "Door entry", price: 80, max: 80, est: 60 },
      { id: "t2", name: "Advance", price: 60, max: 40, est: 25 },
    ]);
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    // Exactly what the planner writes when the operator edits ONE tier: Advance
    // at 30 rather than the 25 the event forecast. Door entry stays untouched,
    // because it was already right on the screen.
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: "Advance",
      amount: 180_000n,
      currency: "SEK",
      details: { basis: "ticket_tier", unitAmount: "6000", quantity: 30 },
    });

    await ensureSettlementLines(harness.db, eventId);
    const lines = await linesOf(eventId);
    const revenue = lines.filter((line) => line.kind === "revenue");

    // Both tiers settle, and the operator's edited figure is the one that stands.
    expect(revenue.map((line) => line.label).sort()).toEqual(["Advance", "Door entry"]);
    expect(revenue.find((line) => line.label === "Advance")?.amount).toBe(180_000n);
    expect(revenue.find((line) => line.label === "Door entry")?.amount).toBe(480_000n);
    // The whole door, not the fraction somebody happened to retype.
    expect(revenue.reduce((running, line) => running + line.amount, 0n)).toBe(660_000n);
  });

  it("does not re-materialise a tier the planner has already written", async () => {
    // The same name is the same tier, however it was cased or spaced when stored —
    // the only identity a write keeps. Getting this wrong doubles that tier.
    const { eventId } = await seedEvent("dedupe", "SEK", [
      { id: "t1", name: "Door entry", price: 80, max: 80, est: 60 },
    ]);
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: " door entry ",
      amount: 480_000n,
      currency: "SEK",
      details: { basis: "ticket_tier", unitAmount: "8000", quantity: 60 },
    });

    await ensureSettlementLines(harness.db, eventId);
    const revenue = (await linesOf(eventId)).filter((line) => line.kind === "revenue");

    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.amount).toBe(480_000n);
  });

  /**
   * THE GAP THE FIRST VERSION OF THIS FIX LEFT OPEN (2026-09-22).
   *
   * The seeding asked whether the budget was EMPTY. That closed the case Ran
   * reported and left the commoner one open, because the planner writes a row the
   * moment the operator TOUCHES it — and the first thing most of them touch is a
   * cost. Type a production figure, never touch the ticket rows already filled in
   * from Event Details, and the budget is no longer empty: the seeding did not
   * fire, the copy took the cost alone, and the night settled with COSTS AND NO
   * REVENUE. A negative pool, every percentage deal paying zero, and the act back
   * on the guarantee floor — Ran's own symptom by a shorter road.
   *
   * The question is whether the budget STATES A DOOR, never whether it holds rows.
   */
  it("carries the door across a budget that holds only costs", async () => {
    const { eventId } = await seedEvent("costonly", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "cost",
      label: "Sound & production",
      amount: 1_200_000n,
      currency: "SEK",
    });

    await ensureSettlementLines(harness.db, eventId);
    const lines = await linesOf(eventId);
    // The operator's cost, AND the door they were looking at while they typed it.
    expect(lines.map((line) => line.kind).sort()).toEqual(["cost", "revenue"]);
    expect(lines.find((line) => line.kind === "revenue")?.amount).toBe(40_000_000n);
    expect(lines.find((line) => line.kind === "cost")?.amount).toBe(1_200_000n);
  });

  /**
   * The bar is revenue and is NOT the door. A sheet whose only revenue row is a bar
   * estimate has still never stated what the tickets take, so the tiers belong in
   * it — and `isTicketRevenueBasis` is the one rule that decides, shared with the
   * settlement so the two cannot disagree about which revenue a deal divides.
   */
  it("does not mistake a bar estimate for a stated door", async () => {
    const { eventId } = await seedEvent("baronly", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: "Bar",
      amount: 500_000n,
      currency: "SEK",
      details: { basis: "bar_spend", unitAmount: "5000", quantity: 100 },
    });

    await ensureSettlementLines(harness.db, eventId);
    const lines = await linesOf(eventId);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.label === "General")?.amount).toBe(40_000_000n);
  });

  it("writes nothing for a tier that forecasts nothing", async () => {
    // A zero price or zero expected sales is not a forecast; a zero row would be
    // a line in the ledger the settlement reconciles that nobody entered.
    const { eventId } = await seedEvent("empty", "SEK", [
      { id: "t1", name: "Free", price: 0, max: 100, est: 100 },
      { id: "t2", name: "Unsold", price: 500, max: 100, est: 0 },
    ]);
    const result = await ensureSettlementLines(harness.db, eventId);
    expect(result.copied).toBe(0);
    expect(await linesOf(eventId)).toHaveLength(0);
  });

  it("still settles an event with no tiers at all on its deals alone", async () => {
    const { eventId } = await seedEvent("notiers", "SEK", undefined);
    const result = await ensureSettlementLines(harness.db, eventId);
    expect(result).toEqual({ copied: 0, alreadyHad: false });
  });

  it("does not re-seed once the settlement has its copy", async () => {
    // The seal: a second run must not re-pull, or the actuals somebody typed are
    // discarded — the whole reason the copy is taken once.
    const { eventId } = await seedEvent("sealed", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);
    expect((await ensureSettlementLines(harness.db, eventId)).copied).toBe(1);
    const second = await ensureSettlementLines(harness.db, eventId);
    expect(second).toEqual({ copied: 0, alreadyHad: true });
    expect(await linesOf(eventId)).toHaveLength(1);
  });
});

/**
 * THE MIRROR OF THE ABOVE, AND THE COMMONEST SHAPE THERE IS (2026-09-26).
 *
 * Everything in the block above hand-builds a `shared` budget, which is exactly
 * what hid this: provisioning gave an event with ONE operator only a `private`
 * book, and `copyBudgetOnce` reads the shared one and only the shared one. So the
 * operator typed the night's costs into the single book the planner offered them,
 * `seedTicketTiersIntoBudget` created a shared ledger of its own for the event's
 * ticket tiers, and the settlement came out with revenue and no costs at all.
 *
 * Measured on a one-operator event before the fix: a SEK 1,000 production cost in
 * the planner, Deductions SEK 0 in the settlement, and the 70% act paid 4,410
 * instead of 3,710. It survived the 2026-09-21 session because the seeded
 * reference event is co-hosted and therefore had a shared ledger all along.
 *
 * So this drives the app's OWN provisioning rather than inserting a budget, which
 * is the only way the two halves can be caught disagreeing.
 */
describe("a night run by one operator settles the costs its operator typed", () => {
  it("gives a solo operator one book, and it is the book the settlement copies", async () => {
    const { eventId, profileId } = await seedEvent("solobook", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);

    await ensureEventBudgets(harness.db, eventId, [profileId]);

    const books = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, eventId));
    // ONE book — so the planner shows no scope chooser and the operator cannot
    // pick the wrong one — and it is the ledger, not a margin line.
    expect(books).toHaveLength(1);
    expect(books[0]?.scope).toBe("shared");
    expect(books[0]?.ownerProfileId).toBeNull();

    const budgetId = books[0]?.id;
    if (!budgetId) throw new Error("provisioning opened no book");
    await harness.db.insert(schema.budgetLines).values({
      budgetId,
      kind: "cost",
      label: "Production",
      amount: 100_000n, // SEK 1,000
      currency: "SEK",
    });

    await ensureSettlementLines(harness.db, eventId);

    const lines = await linesOf(eventId);
    // The cost the operator typed, beside the door they were looking at while
    // they typed it. Before the fix this was the door alone.
    expect(lines.map((line) => line.kind).sort()).toEqual(["cost", "revenue"]);
    expect(lines.find((line) => line.kind === "cost")?.amount).toBe(100_000n);
    expect(lines.find((line) => line.kind === "revenue")?.amount).toBe(40_000_000n);
  });

  it("keeps a co-operator's private margin book out of the reconciliation", async () => {
    // The other half of the same rule, and the reason the fix is "provision the
    // ledger" rather than "settle whatever book exists": once there IS a co-host,
    // a private book is a real second book and must stay outside the settlement.
    const { eventId, profileId } = await seedEvent("cohostbook", "SEK", [
      { id: "t1", name: "General", price: 2000, max: 200, est: 200 },
    ]);
    const [coHost] = await harness.db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "cohostbook",
        name: "cohostbook co",
        slug: "cohostbook-co",
      })
      .returning();
    if (!coHost) throw new Error("co-host profile seed failed");
    await harness.db.insert(schema.eventParticipants).values({
      eventId,
      profileId: coHost.id,
      role: "co_host",
      status: "confirmed",
    });

    await ensureEventBudgets(harness.db, eventId, [profileId]);

    const books = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, eventId));
    const shared = books.find((book) => book.scope === "shared");
    const ownPrivate = books.find((book) => book.scope === "private");
    expect(shared?.ownerProfileId).toBeNull();
    expect(ownPrivate?.ownerProfileId).toBe(profileId);

    const sharedId = shared?.id;
    const privateId = ownPrivate?.id;
    if (!sharedId || !privateId) throw new Error("provisioning opened the wrong books");
    await harness.db.insert(schema.budgetLines).values([
      { budgetId: sharedId, kind: "cost", label: "Production", amount: 100_000n, currency: "SEK" },
      {
        budgetId: privateId,
        kind: "cost",
        label: "Promoter margin",
        amount: 999_999n,
        currency: "SEK",
      },
    ]);

    await ensureSettlementLines(harness.db, eventId);

    const lines = await linesOf(eventId);
    expect(lines.map((line) => line.label).sort()).toEqual(["General", "Production"]);
    expect(lines.some((line) => line.label === "Promoter margin")).toBe(false);
  });
});
