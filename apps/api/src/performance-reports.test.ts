import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { performanceReportRoutes } from "./routes/performance-reports";
import { setlistRoutes } from "./routes/setlists";
import { buildTestApp } from "./testing";

/**
 * The operator's PRO filing (decisions.md "Setlists", RESOLVED) — the half of the
 * setlist module that faces the collecting society.
 *
 * The two rules these tests exist to hold down:
 *   1. **The territory decides the society**, resolved from the venue profile's
 *      recorded country (decisions.md #17), and the ROYALTY ESTIMATE exists only
 *      where an admin configured that territory's published tariff. No tariff, no
 *      number — never a fallback percentage on a document a society receives.
 *   2. **The operator files and the act authors, and neither can do the other's
 *      job.** Both directions are asserted here against the real engine, not just
 *      in `packages/auth`'s unit tests over `isGrantable`.
 */

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    performanceReportRoutes,
    setlistRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

type AccountKind = "operator" | "performer" | "team_and_crew" | "agent";
type ParticipantRole = "host" | "co_host" | "performer" | "crew" | "agent";

async function seedMemberWithSet(
  id: string,
  kind: AccountKind,
  capabilities: readonly string[],
  name = id,
) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId: profile.id, name: id, capabilities: [...capabilities] })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { profileId: profile.id, permissionSetId: set.id };
}

/** A venue profile with a recorded address — the only thing that places a show. */
async function seedVenue(id: string, country: string | null) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  const [venue] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: `${id} Hall`, slug: id })
    .returning();
  if (!venue) throw new Error("venue seed failed");
  if (country) {
    await db
      .insert(schema.profileLocations)
      .values({ profileId: venue.id, city: "Somewhere", country, isPrimary: true });
  }
  return venue.id;
}

async function seedEvent(
  operator: { profileId: string; permissionSetId: string },
  participants: {
    profileId: string;
    permissionSetId: string;
    role: ParticipantRole;
  }[],
  createdBy: string,
  options: { venueProfileId?: string; baseCurrency?: string } = {},
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Filing Night",
      eventDate: "2026-09-12",
      venueName: "The Room",
      timezone: "Europe/Stockholm",
      venueProfileId: options.venueProfileId,
      baseCurrency: options.baseCurrency ?? "SEK",
      createdBy,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  const rows = await db
    .insert(schema.eventParticipants)
    .values(
      participants.map((participant) => ({
        eventId: event.id,
        profileId: participant.profileId,
        role: participant.role,
        permissionSetId: participant.permissionSetId,
        status: "confirmed" as const,
      })),
    )
    .returning();
  return { event, participants: rows };
}

/** A shared ledger with one ticket-tier revenue line — what the estimate is charged on. */
async function seedTicketRevenue(eventId: string, amount: bigint, currency?: string) {
  const { db } = harness;
  const [budget] = await db.insert(schema.budgets).values({ eventId, scope: "shared" }).returning();
  if (!budget) throw new Error("budget seed failed");
  await db.insert(schema.budgetLines).values({
    budgetId: budget.id,
    kind: "revenue",
    label: "Advance",
    amount,
    currency,
    details: { basis: "ticket_tier", unitAmount: Number(amount), quantity: 1 },
  });
  return budget.id;
}

async function writeSetlist(eventId: string, uid: string, items: unknown[]) {
  const response = await app.inject({
    method: "PUT",
    url: `/api/v1/events/${eventId}/setlists`,
    headers: auth(uid),
    payload: { items },
  });
  expect(response.statusCode).toBe(200);
}

describe("performance reports — the operator files a show away to its society", () => {
  it("resolves the society from the venue's COUNTRY, files, and shows the filing afterwards", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "pr1-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr1-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
      "Marlo Vance",
    );
    // A SWEDISH room. Nothing about the event's name, the venue's name or the
    // operator's own country is consulted — only this address.
    const venueProfileId = await seedVenue("pr1-venue", "SE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr1-op",
      { venueProfileId },
    );
    await writeSetlist(event.id, "pr1-perf", [
      { title: "Neon Rooftops", duration: 245 },
      { title: "Paper Districts", duration: 198 },
    ]);

    const draft = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr1-op"),
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().country).toBe("SE");
    expect(draft.json().society.name).toBe("STIM");
    expect(draft.json().works).toHaveLength(2);
    // The act is named on every work, not once on the document — a support slot's
    // songs must never be filed under the headliner.
    expect(draft.json().works[0].performer).toBe("Marlo Vance");
    expect(draft.json().report).toBeNull(); // nothing filed yet

    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr1-op"),
      payload: { reference: "STIM-2026-0918" },
    });
    expect(filed.statusCode).toBe(200);
    expect(filed.json().report.proName).toBe("STIM");
    expect(filed.json().report.country).toBe("SE");
    expect(filed.json().report.reference).toBe("STIM-2026-0918");
    expect(filed.json().report.works).toHaveLength(2);
    expect(filed.json().report.filedByProfileId).toBe(operator.profileId);

    // The ROW exists — the screen is reading state, not remembering a click.
    const rows = await db
      .select()
      .from(schema.performanceReports)
      .where(eq(schema.performanceReports.eventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filedByUserId).toBe("pr1-op");

    // And a re-read sees it, which is what stops the button offering to file the
    // same thing twice with no trace.
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr1-op"),
    });
    expect(after.json().report.id).toBe(rows[0]?.id);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, rows[0]?.id ?? ""));
    expect(audit.map((row) => row.action)).toContain("performance_report.file");
  });

  it("a re-file AMENDS the one row and the audit log carries both acts", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "pr2-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr2-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
      "Vera Lund",
    );
    const venueProfileId = await seedVenue("pr2-venue", "DE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr2-op",
      { venueProfileId },
    );
    await writeSetlist(event.id, "pr2-perf", [{ title: "First" }]);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr2-op"),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().report.proName).toBe("GEMA"); // a German room, not a Swedish one
    expect(first.json().report.works).toHaveLength(1);

    // The act adds an encore and the operator reports again.
    await writeSetlist(event.id, "pr2-perf", [{ title: "First" }, { title: "Encore" }]);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr2-op"),
      payload: { reference: "GEMA-77" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().report.id).toBe(first.json().report.id); // same row, amended
    expect(second.json().report.works).toHaveLength(2);

    const rows = await db
      .select()
      .from(schema.performanceReports)
      .where(eq(schema.performanceReports.eventId, event.id));
    expect(rows).toHaveLength(1); // never two filings for one night

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, rows[0]?.id ?? ""));
    const actions = audit.map((row) => row.action);
    expect(actions).toContain("performance_report.file");
    expect(actions).toContain("performance_report.refile");
  });

  it("the works are SNAPSHOTTED — editing the setlist afterwards does not rewrite the filing", async () => {
    const operator = await seedMemberWithSet(
      "pr3-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr3-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const venueProfileId = await seedVenue("pr3-venue", "SE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr3-op",
      { venueProfileId },
    );
    await writeSetlist(event.id, "pr3-perf", [{ title: "As reported" }]);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr3-op"),
      payload: {},
    });

    // The performer keeps authoring — the setlist is theirs forever.
    await writeSetlist(event.id, "pr3-perf", [{ title: "Rewritten later" }]);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr3-op"),
    });
    // The DRAFT moves with the setlist; the RECORD of what was reported does not.
    expect(after.json().works[0].title).toBe("Rewritten later");
    expect(after.json().report.works[0].title).toBe("As reported");
  });
});

describe("performance reports — an estimate is a published tariff or it is nothing", () => {
  it("has NO estimate when the territory has no configured tariff", async () => {
    const operator = await seedMemberWithSet(
      "pr4-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr4-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const venueProfileId = await seedVenue("pr4-venue", "FR");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr4-op",
      { venueProfileId },
    );
    await seedTicketRevenue(event.id, 100_000n);
    await writeSetlist(event.id, "pr4-perf", [{ title: "Une chanson" }]);

    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr4-op"),
      payload: {},
    });
    expect(filed.statusCode).toBe(200);
    // France is a real territory with a real society, and nobody has entered
    // SACEM's tariff. The society is named; the money is NOT guessed.
    expect(filed.json().society.name).toBe("SACEM");
    expect(filed.json().report.proName).toBe("SACEM");
    expect(filed.json().estimate).toBeNull();
    expect(filed.json().report.estimate).toBeNull();
    expect(filed.json().report.rateBasisPoints).toBeNull();
    // Emphatically not the Budget Planner's flat 6% (which would be "6000").
    expect(filed.json().report.estimate).not.toBe("6000");
  });

  it("estimates from the TERRITORY's tariff, on ticket revenue only, and locks the basis", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "pr5-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr5-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const venueProfileId = await seedVenue("pr5-venue", "NO");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr5-op",
      { venueProfileId, baseCurrency: "NOK" },
    );

    // 1 000.00 of tickets, plus a bar estimate and a sponsorship that a PRO
    // tariff is NOT levied on — the royalty follows the performance.
    const budgetId = await seedTicketRevenue(event.id, 100_000n);
    await db.insert(schema.budgetLines).values([
      {
        budgetId,
        kind: "revenue",
        label: "Bar",
        amount: 50_000n,
        details: { basis: "bar_spend" },
      },
      {
        budgetId,
        kind: "revenue",
        label: "Sponsor",
        amount: 40_000n,
        details: { basis: "custom_revenue" },
      },
    ]);

    // A platform admin has read TONO's published tariff and entered it.
    await db.insert(schema.performingRightsRates).values({
      country: "NO",
      proCode: "none",
      proName: "TONO",
      rateBasisPoints: 750,
      sourceUrl: "https://www.tono.no/tariffs",
      sourceNote: "Live concerts, 2026",
    });
    await writeSetlist(event.id, "pr5-perf", [{ title: "Fjord" }]);

    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr5-op"),
      payload: {},
    });
    expect(filed.statusCode).toBe(200);
    const report = filed.json().report;
    // 7.50% of 100 000 minor units = 7 500. Not of 190 000.
    expect(report.ticketRevenue).toBe("100000");
    expect(report.rateBasisPoints).toBe(750);
    expect(report.estimate).toBe("7500");
    expect(report.estimateCurrency).toBe("NOK");
    // Money crosses the JSON boundary as a STRING (money.md).
    expect(typeof report.estimate).toBe("string");
    // The tariff's own society name wins over the register's.
    expect(report.proName).toBe("TONO");
  });

  it("refuses to file a show it cannot place, and one with no setlist", async () => {
    const operator = await seedMemberWithSet(
      "pr6-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr6-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    // No venue profile at all → no country → no society.
    const placeless = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr6-op",
    );
    await writeSetlist(placeless.event.id, "pr6-perf", [{ title: "Nowhere" }]);
    const unplaced = await app.inject({
      method: "POST",
      url: `/api/v1/events/${placeless.event.id}/performance-report`,
      headers: auth("pr6-op"),
      payload: {},
    });
    expect(unplaced.statusCode).toBe(400);
    expect(unplaced.json().error.message).toMatch(/country/i);

    // A placed show that nobody has written a setlist for → nothing to report.
    const venueProfileId = await seedVenue("pr6-venue", "SE");
    const silent = await seedEvent(operator, [{ ...operator, role: "host" }], "pr6-op", {
      venueProfileId,
    });
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1/events/${silent.event.id}/performance-report`,
      headers: auth("pr6-op"),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toMatch(/setlist/i);
  });
});

describe("performance reports — the operator files, the act authors, neither swaps", () => {
  it("a performer cannot file, and cannot read the operator's filing", async () => {
    const operator = await seedMemberWithSet(
      "pr7-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pr7-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const venueProfileId = await seedVenue("pr7-venue", "SE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr7-op",
      { venueProfileId },
    );
    await writeSetlist(event.id, "pr7-perf", [{ title: "Mine" }]);

    const filing = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr7-perf"),
      payload: {},
    });
    expect(filing.statusCode).toBe(403);
    expect(filing.json().error.message).toContain("performance_report.file");

    // The filing surface itself is the operator's cost planning, gated with it.
    const reading = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr7-perf"),
    });
    expect(reading.statusCode).toBe(403);
  });

  it("an operator handed the performer's capability still cannot author a setlist (ceiling)", async () => {
    // The permission set LISTS `setlist.author`; the engine refuses it to a host
    // anyway, because the setlist is the act's own artistic content and not even
    // a managing operator may be granted it (presets: PERFORMER_AUTHORED).
    const operator = await seedMemberWithSet("pr8-op", "operator", [
      ...PRESET_PERMISSION_SETS.operator_full,
      "setlist.author",
    ]);
    const performer = await seedMemberWithSet(
      "pr8-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const venueProfileId = await seedVenue("pr8-venue", "SE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr8-op",
      { venueProfileId },
    );

    const authoring = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("pr8-op"),
      payload: { items: [{ title: "The operator's idea of the set" }] },
    });
    expect(authoring.statusCode).toBe(403);
    expect(authoring.json().error.message).toContain("setlist.author");
  });

  it("a performer handed the filing capability still cannot file (the mirror ceiling)", async () => {
    // The other direction, and the reason `performance_report.file` is not simply
    // absent from the performer preset: an operator could otherwise grant it.
    const operator = await seedMemberWithSet(
      "pr9-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet("pr9-perf", "performer", [
      ...PRESET_PERMISSION_SETS.performer,
      "performance_report.file",
    ]);
    const venueProfileId = await seedVenue("pr9-venue", "SE");
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "pr9-op",
      { venueProfileId },
    );
    await writeSetlist(event.id, "pr9-perf", [{ title: "Still mine" }]);

    const filing = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr9-perf"),
      payload: {},
    });
    expect(filing.statusCode).toBe(403);
  });

  it("a stranger gets a 404, not a 403 — no existence leak", async () => {
    const operator = await seedMemberWithSet(
      "pr10-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedMemberWithSet("pr10-out", "operator", PRESET_PERMISSION_SETS.operator_full);
    const venueProfileId = await seedVenue("pr10-venue", "SE");
    const { event } = await seedEvent(operator, [{ ...operator, role: "host" }], "pr10-op", {
      venueProfileId,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/performance-report`,
      headers: auth("pr10-out"),
    });
    expect(response.statusCode).toBe(404);
  });
});
