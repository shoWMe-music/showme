import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { canUseFeature } from "./lib/entitlements";
import { eventRoutes } from "./routes/events";
import { eventListRoutes } from "./routes/events-list";
import { buildTestApp } from "./testing";

/**
 * Archiving an event — `POST /events/:id/{archive,unarchive}`.
 *
 * The four things worth proving, because each of them is a decision that could
 * have gone the other way:
 *
 * 1. It is NOT a status. `events.status` is untouched, so a concluded show and a
 *    cancelled one stay distinguishable after both are filed away.
 * 2. It is PER PARTICIPANT. The operator filing a show away does not take it off
 *    the performer's list — an operator's filing preference is not a fact about
 *    somebody else's calendar (`docs/story.md`).
 * 3. It costs nothing and frees nothing. Archiving a confirmed event must NEVER
 *    release a free-tier plan slot, or archiving becomes the way to dodge the cap.
 * 4. It is reversible, and findable in the meantime (`?archived=only`).
 */

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    eventListRoutes,
    eventRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

/** Every archive call resolves an ACTING profile, so both headers always travel. */
const actingAs = (uid: string, profileId: string) => ({
  authorization: `Bearer ${uid}`,
  "x-profile-id": profileId,
});

async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer",
  capabilities: readonly string[],
) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({
      profileId: profile.id,
      name: capabilities.join("+"),
      capabilities: [...capabilities],
    })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { userId: id, profileId: profile.id, permissionSetId: set.id };
}

type SeededMember = Awaited<ReturnType<typeof seedMemberWithSet>>;

async function seedHostedEvent(
  title: string,
  host: SeededMember,
  extra: Record<string, unknown> = {},
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: host.profileId,
      title,
      baseCurrency: "SEK",
      createdBy: host.userId,
      ...extra,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId: host.profileId,
    role: "host",
    permissionSetId: host.permissionSetId,
    status: "confirmed",
  });
  return event;
}

/** Put a second profile on the bill with the given preset. */
async function addParticipant(
  eventId: string,
  member: SeededMember,
  role: "performer" | "crew" = "performer",
) {
  await harness.db.insert(schema.eventParticipants).values({
    eventId,
    profileId: member.profileId,
    role,
    permissionSetId: member.permissionSetId,
    status: "confirmed",
  });
}

/** The ids the caller's default (unarchived) list returns. */
async function listedIds(member: SeededMember, query = ""): Promise<string[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/events${query}`,
    headers: actingAs(member.userId, member.profileId),
  });
  expect(response.statusCode).toBe(200);
  return (response.json().items as { id: string }[]).map((event) => event.id);
}

describe("POST /events/:id/archive — filing, not a status", () => {
  it("takes the event out of the default list and puts it in ?archived=only", async () => {
    const operator = await seedMemberWithSet(
      "arc-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const filed = await seedHostedEvent("Filed away", operator);
    const kept = await seedHostedEvent("Still live", operator);

    expect(await listedIds(operator)).toEqual(expect.arrayContaining([filed.id, kept.id]));

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/events/${filed.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json()).toMatchObject({ id: filed.id, archived: true });
    expect(archive.json().archivedAt).toBeTypeOf("string");

    const remaining = await listedIds(operator);
    expect(remaining).toContain(kept.id);
    expect(remaining).not.toContain(filed.id);

    // The way back. A feature that hides things with no way to find them is a
    // delete that lies about itself.
    const archived = await listedIds(operator, "?archived=only");
    expect(archived).toEqual([filed.id]);
    expect(await listedIds(operator, "?archived=include")).toEqual(
      expect.arrayContaining([filed.id, kept.id]),
    );
  });

  it("marks the row it returns, so the menu knows which way round it is", async () => {
    const operator = await seedMemberWithSet(
      "arc-flag",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Flagged", operator);

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(before.json().items[0]).toMatchObject({ id: event.id, archived: false });

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/events?archived=only",
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(after.json().items[0]).toMatchObject({ id: event.id, archived: true });
  });

  it("leaves events.status alone — a cancelled archive is still cancelled", async () => {
    const operator = await seedMemberWithSet(
      "arc-status",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const concluded = await seedHostedEvent("Done", operator, { status: "concluded" });
    const cancelled = await seedHostedEvent("Called off", operator, { status: "cancelled" });

    for (const event of [concluded, cancelled]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/archive`,
        headers: actingAs(operator.userId, operator.profileId),
      });
      expect(response.statusCode).toBe(200);
    }

    // The state, not just the response: the word that says WHICH kind of finished
    // this event is survives being filed away. This is the whole reason `archived`
    // is not a value in the `event_status` enum.
    const rows = await harness.db
      .select({ id: schema.events.id, status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, operator.profileId));
    const statusById = new Map(rows.map((row) => [row.id, row.status]));
    expect(statusById.get(concluded.id)).toBe("concluded");
    expect(statusById.get(cancelled.id)).toBe("cancelled");
  });

  it("is reversible — unarchive puts it back in the everyday list", async () => {
    const operator = await seedMemberWithSet(
      "arc-undo",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Back again", operator);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(await listedIds(operator)).not.toContain(event.id);

    const unarchive = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unarchive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json()).toMatchObject({ id: event.id, archived: false, archivedAt: null });

    expect(await listedIds(operator)).toContain(event.id);
    expect(await listedIds(operator, "?archived=only")).not.toContain(event.id);
  });

  it("is idempotent — archiving twice writes one history line, not two", async () => {
    const operator = await seedMemberWithSet(
      "arc-twice",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Double click", operator);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // The timestamp is the FIRST filing, not the retry's.
    expect(second.json().archivedAt).toBe(first.json().archivedAt);

    const activity = await harness.db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.eventId, event.id),
          eq(schema.activityLog.type, "event.archived"),
        ),
      );
    expect(activity).toHaveLength(1);
  });

  it("writes an audit row and a participant-scoped activity row", async () => {
    const operator = await seedMemberWithSet(
      "arc-trail",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Trailed", operator);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });

    const [participant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    if (!participant) throw new Error("participant missing");

    const [audit] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, event.id));
    expect(audit).toMatchObject({
      action: "event.archive",
      capability: "event.view",
      targetKind: "event_participant",
      targetId: participant.id,
    });

    const [activity] = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, event.id));
    // `archive` is a PARTICIPANT-SCOPED activity kind: the row hangs off the
    // filing participant's own id, so the feed shows it to them and not to the
    // rest of the bill. Filing is not news about the show.
    expect(activity).toMatchObject({
      type: "event.archived",
      targetKind: "archive",
      targetId: participant.id,
    });
  });
});

describe("archiving is one profile's filing, not the event's state", () => {
  it("does not take the show off the performer's list when the operator files it", async () => {
    const operator = await seedMemberWithSet(
      "arc-host",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "arc-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Shared bill", operator);
    await addParticipant(event.id, performer);

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(archive.statusCode).toBe(200);

    expect(await listedIds(operator)).not.toContain(event.id);
    // The performer's world is "my bookings, my availability, my money"
    // (docs/story.md). The operator deciding they are done looking at a show is
    // not a fact about the performer's calendar.
    expect(await listedIds(performer)).toContain(event.id);
    expect(await listedIds(performer, "?archived=only")).not.toContain(event.id);
  });

  it("lets each side file independently, and each unarchive restores only their own", async () => {
    const operator = await seedMemberWithSet(
      "arc-both-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "arc-both-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Both file it", operator);
    await addParticipant(event.id, performer);

    for (const member of [operator, performer]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/archive`,
        headers: actingAs(member.userId, member.profileId),
      });
      expect(response.statusCode).toBe(200);
    }
    expect(await listedIds(operator, "?archived=only")).toContain(event.id);
    expect(await listedIds(performer, "?archived=only")).toContain(event.id);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unarchive`,
      headers: actingAs(performer.userId, performer.profileId),
    });
    expect(await listedIds(performer)).toContain(event.id);
    expect(await listedIds(operator)).not.toContain(event.id);
  });
});

describe("who may archive", () => {
  it("refuses a stranger with 404 — no existence leak", async () => {
    const operator = await seedMemberWithSet(
      "arc-owner",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const stranger = await seedMemberWithSet(
      "arc-stranger",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Not yours", operator);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(stranger.userId, stranger.profileId),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toContain("Event not found");
  });

  it("accepts a view-only participant — event.view is the gate, not event.edit", async () => {
    const operator = await seedMemberWithSet(
      "arc-vo-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const viewer = await seedMemberWithSet(
      "arc-vo-crew",
      "performer",
      PRESET_PERMISSION_SETS.view_only,
    );
    const event = await seedHostedEvent("Watched", operator);
    await addParticipant(event.id, viewer, "crew");

    // The positive control that makes the refusals above mean something: the
    // narrowest preset in the catalog can still tidy its own list, because the
    // row being written is its own participation and nobody else can see it.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(viewer.userId, viewer.profileId),
    });
    expect(response.statusCode).toBe(200);
    expect(await listedIds(viewer)).not.toContain(event.id);
    expect(await listedIds(operator)).toContain(event.id);
  });

  it("refuses when the acting profile is not the one standing on the event", async () => {
    const operator = await seedMemberWithSet(
      "arc-two-hats-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("One hat only", operator);

    // A second profile the same user belongs to, but which is NOT on this event.
    const [other] = await harness.db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: operator.userId,
        name: "arc-two-hats-other",
        slug: "arc-two-hats-other",
      })
      .returning();
    if (!other) throw new Error("profile seed failed");
    await harness.db
      .insert(schema.profileMembers)
      .values({ profileId: other.id, userId: operator.userId, role: "owner", status: "active" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(operator.userId, other.id),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("on this event");

    // And nothing was written — the other profile's list is untouched.
    const rows = await harness.db
      .select({ archivedAt: schema.eventParticipants.archivedAt })
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    expect(rows.every((row) => row.archivedAt === null)).toBe(true);
  });

  it("refuses without an acting profile at all", async () => {
    const operator = await seedMemberWithSet(
      "arc-no-profile",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Needs a hat", operator);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: { authorization: `Bearer ${operator.userId}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("X-Profile-Id");
  });
});

/**
 * THE entitlement question, and the test that should fail loudly if the answer
 * ever changes.
 *
 * `CAP_COUNTING_EVENT_STATUSES = ["confirmed","concluded"]` decides which events
 * consume a free_operator's three-event allowance. If archiving released a slot,
 * an operator could archive a confirmed show and confirm another one for free —
 * over and over. Archiving therefore has to be free AND weightless: it changes
 * nothing about what the plan has been charged for.
 *
 * It is weightless by CONSTRUCTION, not by a rule someone has to remember: the
 * counter reads `events.status`, and archiving writes
 * `event_participants.archived_at`. There is nothing in the archive path for the
 * counter to see. These tests pin that down at both ends — the counter itself,
 * and the route that charges it.
 */
describe("archiving never moves a plan slot", () => {
  it("keeps a free_operator's event count exactly where it was", async () => {
    const operator = await seedMemberWithSet(
      "arc-cap",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Live one", operator, { status: "confirmed" });
    await seedHostedEvent("Live two", operator, { status: "confirmed" });
    const third = await seedHostedEvent("Live three", operator, { status: "confirmed" });

    // Events are uncapped now (Basic advertises "Unlimited events"), so the cap
    // is no longer the observable. What this test is really about survives:
    // archiving is FILING, not cancelling.
    const before = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(before.allowed).toBe(true);

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/events/${third.id}/archive`,
      headers: actingAs(operator.userId, operator.profileId),
    });
    expect(archive.statusCode).toBe(200);

    // Filing a show away does not un-book it: the event is still CONFIRMED, which
    // is the fact the cap used to prove indirectly and is now asserted directly.
    const [stillBooked] = await harness.db
      .select({ status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, third.id));
    expect(stillBooked?.status).toBe("confirmed");
  });

  it("lets a fourth event be confirmed after three are archived", async () => {
    const operator = await seedMemberWithSet(
      "arc-cap-route",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const live = [
      await seedHostedEvent("Booked one", operator, { status: "confirmed" }),
      await seedHostedEvent("Booked two", operator, { status: "confirmed" }),
      await seedHostedEvent("Booked three", operator, { status: "confirmed" }),
    ];
    const fourth = await seedHostedEvent("The dodge", operator, { status: "draft" });

    for (const event of live) {
      const archived = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/archive`,
        headers: actingAs(operator.userId, operator.profileId),
      });
      // Check every setup call, not only the one under test: a 500 here would
      // make the refusal below vacuously true.
      expect(archived.statusCode).toBe(200);
    }

    const confirm = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${fourth.id}`,
      headers: actingAs(operator.userId, operator.profileId),
      payload: { status: "confirmed" },
    });
    // Confirming a fourth show is allowed now: Basic advertises "Unlimited
    // events", so there is no slot to run out of. This test used to assert the
    // opposite — a 403 with "Free plan event limit reached" — which was the
    // product contradicting its own pricing page.
    expect(confirm.statusCode).toBe(200);

    // And the confirmation really landed, in the database rather than only in
    // the response.
    const [row] = await harness.db
      .select({ status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, fourth.id));
    expect(row?.status).toBe("confirmed");
  });
});

/**
 * DELETING AN ARCHIVED EVENT — the one irreversible act in the product.
 *
 * The product owner asked for it in the same breath as the archive: *"Users
 * should be able to move events into archive and then delete them from there if
 * they wish."* The archive half already existed; the delete half existed too, and
 * that was the problem — `DELETE /events/:id` was a bare hard delete behind
 * `event.delete` and an optimistic lock, and it took twenty-three cascading
 * tables with it for every party on the event, not only the caller.
 *
 * The rule it now enforces, reasoned from `docs/story.md`: **archiving is one
 * profile's filing; the EVENT is the shared object where every party meets.**
 * There is one row, so there is no per-party delete to be had — a venue deleting
 * a show would destroy the performer's record of a night they played and were
 * paid for. So an event may be deleted only **while it is nobody's record but
 * yours**, and every clause below is one way it could be somebody else's.
 */
describe("DELETE /events/:id — only while it is nobody's record but yours", () => {
  async function archivedSoloEvent(prefix: string) {
    const host = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent(`${prefix} night`, host);
    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(host.userId, host.profileId),
    });
    expect(archived.statusCode).toBe(200);
    return { host, event };
  }

  it("deletes a solo, archived event and takes its whole tree with it", async () => {
    const { db } = harness;
    const { host, event } = await archivedSoloEvent("del-solo");
    const [participant] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    if (!participant) throw new Error("participant seed failed");

    // Everything a solo operator can accumulate on their own show, INCLUDING the
    // rows that reference `event_participants` with no `ON DELETE` of their own —
    // those are the ones a plain cascade can trip over, so they are exactly the
    // ones worth putting in the way.
    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "performance",
        structure: "guarantee",
        name: "Draft terms",
        guaranteeAmount: 100000n,
        createdBy: host.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");
    await db
      .insert(schema.dealParties)
      .values({ dealId: deal.id, participantId: participant.id, roleInDeal: "payer" });
    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
    if (!budget) throw new Error("budget seed failed");
    await db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: "Tickets",
      amount: 500000n,
      collectedBy: participant.id,
    });
    await db.insert(schema.riders).values({
      eventId: event.id,
      ownerParticipantId: participant.id,
      type: "tech",
      name: "House tech",
      createdBy: host.userId,
    });
    await db.insert(schema.scheduleItems).values({
      eventId: event.id,
      label: "Doors open",
      ownerParticipantId: participant.id,
    });
    await db.insert(schema.eventMessages).values({
      eventId: event.id,
      senderUserId: host.userId,
      senderParticipantId: participant.id,
      body: "Note to self",
    });
    await db.insert(schema.tasks).values({
      eventId: event.id,
      ownerProfileId: host.profileId,
      title: "Book the PA",
      assigneeParticipantId: participant.id,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().deleted).toBe(true);

    // ASSERTED IN THE DATABASE, not in the response — the response cannot tell you
    // what a foreign key took with it.
    expect(await db.select().from(schema.events).where(eq(schema.events.id, event.id))).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.eventParticipants)
        .where(eq(schema.eventParticipants.eventId, event.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.deals).where(eq(schema.deals.id, deal.id))).toEqual([]);
    expect(
      await db.select().from(schema.dealParties).where(eq(schema.dealParties.dealId, deal.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.budgets).where(eq(schema.budgets.eventId, event.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.budgetLines).where(eq(schema.budgetLines.budgetId, budget.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.riders).where(eq(schema.riders.eventId, event.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.scheduleItems)
        .where(eq(schema.scheduleItems.eventId, event.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.eventId, event.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.eventId, event.id))).toEqual(
      [],
    );
  });

  it("records in the audit trail WHAT was destroyed, not merely that it was", async () => {
    const { db } = harness;
    const { host, event } = await archivedSoloEvent("del-audit");
    const [participant] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    if (!participant) throw new Error("participant seed failed");
    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
    if (!budget) throw new Error("budget seed failed");
    await db.insert(schema.budgetLines).values([
      {
        budgetId: budget.id,
        kind: "revenue",
        label: "Tickets",
        amount: 500000n,
        collectedBy: participant.id,
      },
      { budgetId: budget.id, kind: "cost", label: "PA", amount: 100000n, paidBy: participant.id },
    ]);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);

    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.eventId, event.id), eq(schema.auditLog.action, "event.delete")),
      );
    const changes = audit?.changes as {
      before: { event: { title: string }; alsoDeleted: Record<string, number> };
    };
    expect(changes.before.event.title).toBe("del-audit night");
    expect(changes.before.alsoDeleted.eventParticipants).toBe(1);
    expect(changes.before.alsoDeleted.budgetLines).toBe(2);
    expect(changes.before.alsoDeleted.budgets).toBe(1);
  });

  it("refuses while anybody else is on the bill, naming how many", async () => {
    const { host, event } = await archivedSoloEvent("del-bill");
    const act = await seedMemberWithSet(
      "del-bill-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await addParticipant(event.id, act);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("1 other party");
    expect(
      await harness.db.select().from(schema.events).where(eq(schema.events.id, event.id)),
    ).toHaveLength(1);
  });

  it("refuses while a settlement exists — that is a financial record", async () => {
    const { db } = harness;
    const { host, event } = await archivedSoloEvent("del-settled");
    const [participant] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    if (!participant) throw new Error("participant seed failed");
    await db
      .insert(schema.settlements)
      .values({ eventId: event.id, participantId: participant.id });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("settlement");
    expect(
      await db.select().from(schema.events).where(eq(schema.events.id, event.id)),
    ).toHaveLength(1);
  });

  it("refuses while an agreement is confirmed — signatures are on it", async () => {
    const { db } = harness;
    const { host, event } = await archivedSoloEvent("del-signed");
    await db.insert(schema.deals).values({
      eventId: event.id,
      type: "performance",
      structure: "guarantee",
      name: "Signed terms",
      agreementStatus: "confirmed",
      createdBy: host.userId,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("Signed terms");
  });

  it("refuses while an invoice has been raised", async () => {
    const { db } = harness;
    const { host, event } = await archivedSoloEvent("del-invoiced");
    await db.insert(schema.invoices).values({
      eventId: event.id,
      ownerProfileId: host.profileId,
      direction: "issued",
      number: "INV-1",
      currency: "SEK",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("invoice");
  });

  it("refuses an event that has not been archived — delete lives in the archive", async () => {
    const host = await seedMemberWithSet(
      "del-live-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Still live", host);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("Archive");
    expect(
      await harness.db.select().from(schema.events).where(eq(schema.events.id, event.id)),
    ).toHaveLength(1);
  });

  it("refuses a co-host with event.delete who is not the profile operating the show", async () => {
    const { host, event } = await archivedSoloEvent("del-cohost");
    const coHost = await seedMemberWithSet(
      "del-cohost-other",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: coHost.profileId,
      role: "co_host",
      permissionSetId: coHost.permissionSetId,
      status: "confirmed",
    });
    // The co-host archives their own copy, so the archive clause cannot be what
    // refuses them.
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers: actingAs(coHost.userId, coHost.profileId),
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(coHost.userId, coHost.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain("operating this show");
    expect(
      await harness.db.select().from(schema.events).where(eq(schema.events.id, event.id)),
    ).toHaveLength(1);
    // …and the host is still refused too, because the co-host is on the bill.
    const hostAttempt = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: actingAs(host.userId, host.profileId),
      payload: { expectedVersion: 1 },
    });
    expect(hostAttempt.statusCode).toBe(409);
  });
});
