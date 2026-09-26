import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * MIGRATION 0046, run against states it will actually meet.
 *
 * The provisioning fix alone would have healed nothing: an event that already
 * holds a solo operator's `private` book gains a shared ledger on first open,
 * and everything the operator had typed stays behind in a book the settlement
 * does not read — the same blocker, now with the costs one click further away.
 * So the migration relabels that book, and this is the test of THE FILE, read
 * off disk and executed, rather than of a paraphrase of it.
 *
 * It is written as four states rather than one because every clause in that
 * `WHERE` is load-bearing: relabel one book too many and a co-promoter's margin
 * line becomes visible to the operator they were keeping it from, which is a
 * worse bug than the one being fixed.
 *
 * The migration has already run by the time the harness hands the database over,
 * so it is re-executed here against rows built afterwards. That is not a
 * weakness of the test — the statement is idempotent by construction (it only
 * ever moves `private` → `shared`, and its own `NOT EXISTS` refuses an event
 * that has a ledger), and re-running it is the cheapest proof of that too.
 */
const migrationSql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/db/migrations/0046_a_night_run_alone_still_has_one_book.sql",
  ),
  "utf8",
);

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});
afterAll(async () => {
  await harness?.stop();
});

/** An operator profile, and an event they host. */
async function seedOperatorEvent(prefix: string): Promise<{
  eventId: string;
  profileId: string;
}> {
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
      baseCurrency: "SEK",
      status: "confirmed",
      eventDate: "2027-06-10",
      createdBy: prefix,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db
    .insert(schema.eventParticipants)
    .values({ eventId: event.id, profileId: profile.id, role: "host", status: "confirmed" });
  return { eventId: event.id, profileId: profile.id };
}

/** A second operator on an existing event. */
async function seedCoHost(prefix: string, eventId: string): Promise<string> {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id: `${prefix}-co`, email: `${prefix}-co@t.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({
      kind: "operator",
      ownerUserId: `${prefix}-co`,
      name: `${prefix} co`,
      slug: `${prefix}-co-p`,
    })
    .returning();
  if (!profile) throw new Error("co-host profile seed failed");
  await db
    .insert(schema.eventParticipants)
    .values({ eventId, profileId: profile.id, role: "co_host", status: "confirmed" });
  return profile.id;
}

const booksOf = (eventId: string) =>
  harness.db.select().from(schema.budgets).where(eq(schema.budgets.eventId, eventId));

const runMigration = () => harness.db.execute(sql.raw(migrationSql));

describe("migration 0046 — a night run alone still has one book", () => {
  it("makes a solo operator's private book the event's ledger, lines and all", async () => {
    const { eventId, profileId } = await seedOperatorEvent("mig-solo");
    const [book] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "private", ownerProfileId: profileId })
      .returning();
    if (!book) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: book.id,
      kind: "cost",
      label: "Production",
      amount: 100_000n,
      currency: "SEK",
    });

    await runMigration();

    const [healed] = await booksOf(eventId);
    expect(healed?.scope).toBe("shared");
    expect(healed?.ownerProfileId).toBeNull();
    // The SAME row, so the lines came with it. Provisioning a second, empty
    // ledger beside it would have left the cost exactly as stranded as before.
    expect(healed?.id).toBe(book.id);
    const lines = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, book.id));
    expect(lines.map((line) => line.label)).toEqual(["Production"]);
  });

  it("leaves a co-hosted event's private margin books alone", async () => {
    const { eventId, profileId } = await seedOperatorEvent("mig-cohost");
    const coHostProfileId = await seedCoHost("mig-cohost", eventId);
    await harness.db.insert(schema.budgets).values([
      { eventId, scope: "shared", ownerProfileId: null },
      { eventId, scope: "private", ownerProfileId: profileId },
      { eventId, scope: "private", ownerProfileId: coHostProfileId },
    ]);

    await runMigration();

    const books = await booksOf(eventId);
    expect(books.filter((book) => book.scope === "shared")).toHaveLength(1);
    expect(
      books
        .filter((book) => book.scope === "private")
        .map((book) => book.ownerProfileId)
        .sort(),
    ).toEqual([profileId, coHostProfileId].sort());
  });

  it("leaves a solo operator's private book alone once the event has a ledger", async () => {
    // The operator kept a genuine second book. Relabelling it would merge a
    // margin line into the night's reconciliation and double-count it.
    const { eventId, profileId } = await seedOperatorEvent("mig-both");
    await harness.db.insert(schema.budgets).values([
      { eventId, scope: "shared", ownerProfileId: null },
      { eventId, scope: "private", ownerProfileId: profileId },
    ]);

    await runMigration();

    const books = await booksOf(eventId);
    expect(books.filter((book) => book.scope === "shared")).toHaveLength(1);
    expect(books.filter((book) => book.scope === "private")).toHaveLength(1);
  });

  it("leaves behind a private book whose owner is no longer an operator here", async () => {
    // A removed co-promoter's margin line is still theirs. Its event now has one
    // operator, which is exactly the shape the first clause matches — the owner
    // check is what stops it being handed to the operator who remains.
    const { eventId, profileId } = await seedOperatorEvent("mig-removed");
    const goneProfileId = await seedCoHost("mig-removed", eventId);
    await harness.db
      .update(schema.eventParticipants)
      .set({ status: "removed" })
      .where(eq(schema.eventParticipants.profileId, goneProfileId));
    await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "private", ownerProfileId: goneProfileId });

    await runMigration();

    const [book] = await booksOf(eventId);
    expect(book?.scope).toBe("private");
    expect(book?.ownerProfileId).toBe(goneProfileId);
    expect(profileId).not.toBe(goneProfileId);
  });

  it("changes nothing on a second run", async () => {
    const { eventId, profileId } = await seedOperatorEvent("mig-twice");
    await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "private", ownerProfileId: profileId });

    await runMigration();
    const afterFirst = await booksOf(eventId);
    await runMigration();
    const afterSecond = await booksOf(eventId);

    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toEqual(afterFirst);
  });
});
