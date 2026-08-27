import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { activityRoutes } from "./routes/activity";
import { budgetRoutes } from "./routes/budget";
import { dealRoutes } from "./routes/deals";
import { eventRoutes } from "./routes/events";
import { holdRoutes } from "./routes/holds";
import { participantRoutes } from "./routes/participants";
import { riderRoutes } from "./routes/riders";
import { scheduleRoutes } from "./routes/schedule";
import { setlistRoutes } from "./routes/setlists";
import { taskRoutes } from "./routes/tasks";
import { buildTestApp } from "./testing";

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
    dealRoutes,
    participantRoutes,
    eventRoutes,
    holdRoutes,
    scheduleRoutes,
    budgetRoutes,
    riderRoutes,
    taskRoutes,
    setlistRoutes,
    activityRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

async function createProfile(id: string, kind: "operator" | "performer") {
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
  return profile;
}

async function addParticipant(
  eventId: string,
  profileId: string,
  role: "host" | "co_host" | "performer" | "crew",
  capabilities: readonly string[],
) {
  const { db } = harness;
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId, name: role, capabilities: [...capabilities] })
    .returning();
  const [participant] = await db
    .insert(schema.eventParticipants)
    .values({ eventId, profileId, role, permissionSetId: set?.id, status: "confirmed" })
    .returning();
  if (!participant) throw new Error("participant seed failed");
  return participant.id;
}

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

function feedFor(uid: string, eventId?: string) {
  const query = eventId ? `?eventId=${eventId}` : "";
  return app.inject({ method: "GET", url: `/api/v1/activity${query}`, headers: auth(uid) });
}

/** The activity types one user can see, sorted — the whole assertion in one line. */
async function visibleTypes(uid: string, eventId?: string) {
  const response = await feedFor(uid, eventId);
  expect(response.statusCode).toBe(200);
  return (response.json().items as Array<{ type: string }>).map((item) => item.type).sort();
}

describe("activity feed — target-scoped visibility", () => {
  it("shows event-level activity to all, deal activity only to the party, everything to the operator", async () => {
    const { db } = harness;
    const operator = await createProfile("act-op", "operator");
    const performerA = await createProfile("act-a", "performer");
    const performerB = await createProfile("act-b", "performer");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.id,
        title: "Feed Night",
        baseCurrency: "SEK",
        createdBy: "act-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    await addParticipant(event.id, operator.id, "host", PRESET_PERMISSION_SETS.operator_full);
    const aParticipantId = await addParticipant(
      event.id,
      performerA.id,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    // Event-level activity: add performer B via the route.
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("act-op"),
      payload: { profileId: performerB.id, role: "performer" },
    });
    expect(added.statusCode).toBe(201);

    // Party-scoped activity: a deal with performer A as a party.
    const deal = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("act-op"),
      payload: {
        type: "performance",
        name: "A's guarantee",
        parties: [{ participantId: aParticipantId, roleInDeal: "payee" }],
      },
    });
    expect(deal.statusCode).toBe(201);

    const types = async (uid: string) => {
      const response = await feedFor(uid);
      expect(response.statusCode).toBe(200);
      return (response.json().items as Array<{ type: string }>).map((item) => item.type).sort();
    };

    // Operator sees everything on their event.
    expect(await types("act-op")).toEqual(["deal.created", "participant.added"]);

    // Performer A is a party on the deal → sees both.
    expect(await types("act-a")).toEqual(["deal.created", "participant.added"]);

    // Performer B is NOT a party → sees the event-level item, not the deal.
    expect(await types("act-b")).toEqual(["participant.added"]);
  });

  it("returns an empty feed for a user with no reachable events", async () => {
    await createProfile("act-lonely", "operator");
    const response = await feedFor("act-lonely");
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});

describe("activity feed — what an event's history records", () => {
  it("records the event's own lifecycle, and never an update that changed nothing", async () => {
    const operator = await createProfile("hist-op", "operator");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("hist-op"), "x-profile-id": operator.id },
      payload: { title: "History Night", baseCurrency: "SEK" },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;
    const version = created.json().version as number;

    // A real change → one row naming the fields that moved (never their values).
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: { ...auth("hist-op"), "x-profile-id": operator.id },
      payload: { title: "History Night (moved)", capacity: 400, expectedVersion: version },
    });
    expect(renamed.statusCode).toBe(200);

    // A status move → its own type, carrying the values, because status is
    // event-public in the serializer.
    const held = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: { ...auth("hist-op"), "x-profile-id": operator.id },
      payload: { status: "on_hold", expectedVersion: renamed.json().version },
    });
    expect(held.statusCode).toBe(200);

    // A PATCH that re-sends the SAME values: audited, but not history.
    const noop = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: { ...auth("hist-op"), "x-profile-id": operator.id },
      payload: { status: "on_hold", capacity: 400, expectedVersion: held.json().version },
    });
    expect(noop.statusCode).toBe(200);

    expect(await visibleTypes("hist-op", eventId)).toEqual([
      "event.created",
      "event.status_changed",
      "event.updated",
    ]);

    // The audit trail kept all four writes — that is the distinction, in one
    // assertion: audit is every mutation, activity is the curated story.
    const audited = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, eventId));
    expect(audited.filter((row) => row.action === "event.update")).toHaveLength(3);

    // The field NAMES are recorded; the values are not.
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    const updated = rows.find((row) => row.type === "event.updated");
    expect((updated?.summary as { fields: string[] }).fields.sort()).toEqual(["capacity", "title"]);
    expect(JSON.stringify(updated?.summary)).not.toContain("History Night (moved)");
  });

  it("records participant departures and schedule changes, each at its own tier", async () => {
    const operator = await createProfile("hist2-op", "operator");
    const performer = await createProfile("hist2-act", "performer");
    const guest = await createProfile("hist2-guest", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("hist2-op"), "x-profile-id": operator.id },
      payload: { title: "Tiers", baseCurrency: "SEK" },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants`,
      headers: { ...auth("hist2-op"), "x-profile-id": operator.id },
      payload: { profileId: performer.id, role: "performer" },
    });
    expect(added.statusCode).toBe(201);
    const participantId = added.json().id as string;

    // A `view_only` guest. The role matters: `crew` carries `schedule.view` as an
    // INALIENABLE floor (a crew member always sees the running order), so the only
    // participant who can view an event without its schedule is one whose role has
    // the bare `event.view` baseline and a permission set that adds nothing.
    await addParticipant(eventId, guest.id, "co_host", PRESET_PERMISSION_SETS.view_only);

    const scheduled = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/schedule`,
      headers: { ...auth("hist2-op"), "x-profile-id": operator.id },
      payload: { localDateTime: "2026-09-01T18:00:00", label: "Soundcheck" },
    });
    expect(scheduled.statusCode).toBe(201);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}/participants/${participantId}`,
      headers: { ...auth("hist2-op"), "x-profile-id": operator.id },
    });
    expect(removed.statusCode).toBe(200);

    // The operator sees the whole story.
    expect(await visibleTypes("hist2-op", eventId)).toEqual([
      "event.created",
      "participant.added",
      "participant.removed",
      "schedule.created",
    ]);

    // The `view_only` guest reads the event-level news and NOT the running order —
    // the schedule tab is closed to them, so the timeline is too.
    expect(await visibleTypes("hist2-guest", eventId)).toEqual([
      "event.created",
      "participant.added",
      "participant.removed",
    ]);
  });
});

describe("activity feed — the read side gates on capabilities, not on role", () => {
  it("hides operator-only kinds from a co_host who was given a view_only permission set", async () => {
    const operator = await createProfile("cap-op", "operator");
    const restricted = await createProfile("cap-cohost", "operator");

    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: operator.id,
        title: "Rank Night",
        baseCurrency: "SEK",
        status: "on_hold",
        holdRank: 2,
        createdBy: "cap-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    await addParticipant(event.id, operator.id, "host", PRESET_PERMISSION_SETS.operator_full);
    // The leak this test exists for: the ROLE says co_host, the permission set says
    // view-only. Reading the role would have handed them the operator tier.
    await addParticipant(event.id, restricted.id, "co_host", PRESET_PERMISSION_SETS.view_only);

    const ranked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/hold/rank`,
      headers: { ...auth("cap-op"), "x-profile-id": operator.id },
      payload: { holdRank: 1 },
    });
    expect(ranked.statusCode).toBe(200);

    // `hold_rank` is operator-private in `serialize/event.ts`; so is its history.
    expect(await visibleTypes("cap-op", event.id)).toEqual(["hold.ranked"]);
    expect(await visibleTypes("cap-cohost", event.id)).toEqual([]);
  });

  it("returns an empty feed for an event the viewer cannot reach", async () => {
    const stranger = await createProfile("cap-stranger", "operator");
    const owner = await createProfile("cap-owner", "operator");
    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: owner.id,
        title: "Private",
        baseCurrency: "SEK",
        createdBy: "cap-owner",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await addParticipant(event.id, owner.id, "host", PRESET_PERMISSION_SETS.operator_full);
    // The stranger needs a participant row SOMEWHERE, or the early return fires
    // for the wrong reason and the scoping is never exercised.
    const [other] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: stranger.id,
        title: "Theirs",
        baseCurrency: "SEK",
        createdBy: "cap-stranger",
      })
      .returning();
    if (!other) throw new Error("event seed failed");
    await addParticipant(other.id, stranger.id, "host", PRESET_PERMISSION_SETS.operator_full);

    expect(await visibleTypes("cap-stranger", event.id)).toEqual([]);
  });
});

// ── Job 2: the gaps closed on 2026-08-26 (docs/event-history-audit.md) ────────
//
// Each block below drives the REAL route and then reads the feed back as every
// viewpoint the entry can reach — the operator, the party it is about, and a
// bystander on the same event who must not see it. The bystander is the assertion
// that matters: a history entry with the wrong `targetKind` is a back door around
// the ceiling `isGrantable()` enforces on the resource itself.

/** Seed a user + profile + owner membership. Returns the profile id. */
async function seedActor(id: string, kind: "operator" | "performer") {
  const profile = await createProfile(id, kind);
  return profile.id;
}

/** An event hosted by `operatorProfileId`, with the host participant already in. */
async function seedEventWithHost(title: string, operatorProfileId: string, createdBy: string) {
  const [event] = await harness.db
    .insert(schema.events)
    .values({ hostProfileId: operatorProfileId, title, baseCurrency: "SEK", createdBy })
    .returning();
  if (!event) throw new Error("event seed failed");
  const hostParticipantId = await addParticipant(
    event.id,
    operatorProfileId,
    "host",
    PRESET_PERMISSION_SETS.operator_full,
  );
  return { eventId: event.id, hostParticipantId };
}

describe("event history — budget changes reach the operators and stop there", () => {
  it("records a shared budget's lines for operators, and hides them from the performer", async () => {
    const operatorProfileId = await seedActor("bud-op", "operator");
    const performerProfileId = await seedActor("bud-perf", "performer");
    const { eventId, hostParticipantId } = await seedEventWithHost(
      "Budget Night",
      operatorProfileId,
      "bud-op",
    );
    await addParticipant(
      eventId,
      performerProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth("bud-op"),
      payload: { scope: "shared" },
    });
    expect(budget.statusCode).toBe(201);
    const budgetId = budget.json().id as string;

    const line = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth("bud-op"),
      // Every line must attribute its cash to a participant (A-14) — the door take
      // is held by the venue.
      payload: {
        kind: "revenue",
        label: "Door",
        amount: "150000",
        collectedBy: hostParticipantId,
      },
    });
    expect(line.statusCode).toBe(201);
    const lineId = line.json().id as string;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines/${lineId}`,
      headers: auth("bud-op"),
      payload: { amount: "180000" },
    });
    expect(edited.statusCode).toBe(200);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines/${lineId}`,
      headers: auth("bud-op"),
      payload: {},
    });
    expect(removed.statusCode).toBe(200);

    expect(await visibleTypes("bud-op", eventId)).toEqual([
      "budget.created",
      "budget.line_added",
      "budget.line_removed",
      "budget.line_updated",
    ]);

    // The performer holds no `budget.view`, so the pool's working is closed to
    // them — and so is its history. This is the same ceiling the budget screen
    // itself enforces; the feed must not be the way around it.
    expect(await visibleTypes("bud-perf", eventId)).toEqual([]);

    // The AMOUNT never enters a summary, even at the operator tier: the rule in
    // `lib/activity.ts` is absolute, not a per-kind judgement call.
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    const updatedRow = rows.find((row) => row.type === "budget.line_updated");
    expect((updatedRow?.summary as { fields: string[] }).fields).toContain("amount");
    expect(JSON.stringify(rows.map((row) => row.summary))).not.toContain("180000");
  });

  it("writes NO history for a private budget — the co-promoter's margin is not event news", async () => {
    const operatorProfileId = await seedActor("bud2-op", "operator");
    const { eventId, hostParticipantId } = await seedEventWithHost(
      "Private Night",
      operatorProfileId,
      "bud2-op",
    );

    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: { ...auth("bud2-op"), "x-profile-id": operatorProfileId },
      payload: { scope: "private", ownerProfileId: operatorProfileId },
    });
    expect(budget.statusCode).toBe(201);
    const budgetId = budget.json().id as string;

    const line = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: { ...auth("bud2-op"), "x-profile-id": operatorProfileId },
      payload: { kind: "cost", label: "My margin", amount: "50000", paidBy: hostParticipantId },
    });
    expect(line.statusCode).toBe(201);

    // Nothing in the feed — kind `budget` is the operator TIER, which would hand a
    // co-host the row. The change is still recorded forensically.
    expect(await visibleTypes("bud2-op", eventId)).toEqual([]);
    const audited = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, eventId));
    expect(audited.map((row) => row.action).sort()).toEqual([
      "budget.create",
      "budget_line.create",
    ]);
  });
});

describe("event history — a rider reaches its submitter and the operator, nobody else", () => {
  it("records the attach and the withdrawal, and hides both from the other act on the bill", async () => {
    const operatorProfileId = await seedActor("rid-op", "operator");
    const performerProfileId = await seedActor("rid-perf", "performer");
    const otherProfileId = await seedActor("rid-other", "performer");
    const { eventId } = await seedEventWithHost("Rider Night", operatorProfileId, "rid-op");
    await addParticipant(
      eventId,
      performerProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await addParticipant(eventId, otherProfileId, "performer", PRESET_PERMISSION_SETS.performer);

    const library = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performerProfileId}/riders`,
      headers: auth("rid-perf"),
      payload: { type: "hospitality", name: "Green room" },
    });
    expect(library.statusCode).toBe(201);

    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/riders`,
      headers: auth("rid-perf"),
      payload: { sourceRiderId: library.json().id },
    });
    expect(attached.statusCode).toBe(201);

    const withdrawn = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}/riders/${attached.json().id}`,
      headers: auth("rid-perf"),
    });
    expect(withdrawn.statusCode).toBe(204);

    expect(await visibleTypes("rid-perf", eventId)).toEqual(["rider.attached", "rider.removed"]);
    expect(await visibleTypes("rid-op", eventId)).toEqual(["rider.attached", "rider.removed"]);
    // The other act shares the event and holds `event.view`. A rider is one act's
    // private requirements, so the timeline must not say that this one exists.
    expect(await visibleTypes("rid-other", eventId)).toEqual([]);

    // The LIBRARY rider that preceded the attach is profile work, not event
    // history — it carries no event and writes no feed row.
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    expect(rows).toHaveLength(2);
  });
});

describe("event history — an event task is event-level, a personal task is not", () => {
  it("shows an event task to every participant and keeps its budget figure out of the summary", async () => {
    const operatorProfileId = await seedActor("tsk-op", "operator");
    const crewProfileId = await seedActor("tsk-crew", "performer");
    const { eventId } = await seedEventWithHost("Task Night", operatorProfileId, "tsk-op");
    await addParticipant(eventId, crewProfileId, "crew", PRESET_PERMISSION_SETS.crew_schedule_only);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth("tsk-op"), "x-profile-id": operatorProfileId },
      payload: { title: "Book the backline", eventId, budgetAmount: "90000" },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    const completed = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { ...auth("tsk-op"), "x-profile-id": operatorProfileId },
      payload: { completed: true },
    });
    expect(completed.statusCode).toBe(200);

    // A PERSONAL task (no event) must not land in any event's history.
    const personal = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth("tsk-op"), "x-profile-id": operatorProfileId },
      payload: { title: "Call the accountant" },
    });
    expect(personal.statusCode).toBe(201);

    expect(await visibleTypes("tsk-op", eventId)).toEqual(["task.completed", "task.created"]);
    // Crew hold `event.view`, which is the literal gate on reading the task list —
    // so the history sits at the same tier and they see it too.
    expect(await visibleTypes("tsk-crew", eventId)).toEqual(["task.completed", "task.created"]);

    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows.map((row) => row.summary))).not.toContain("90000");
  });
});

describe("event history — a setlist reaches its author and the operator", () => {
  it("records the update for the author and the operator, not for the other act", async () => {
    const operatorProfileId = await seedActor("set-op", "operator");
    const performerProfileId = await seedActor("set-perf", "performer");
    const otherProfileId = await seedActor("set-other", "performer");
    const { eventId } = await seedEventWithHost("Setlist Night", operatorProfileId, "set-op");
    await addParticipant(
      eventId,
      performerProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await addParticipant(eventId, otherProfileId, "performer", PRESET_PERMISSION_SETS.performer);

    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${eventId}/setlists`,
      headers: auth("set-perf"),
      payload: { items: [{ title: "Opener" }, { title: "Closer" }] },
    });
    expect(saved.statusCode).toBe(200);

    expect(await visibleTypes("set-perf", eventId)).toEqual(["setlist.updated"]);
    expect(await visibleTypes("set-op", eventId)).toEqual(["setlist.updated"]);
    expect(await visibleTypes("set-other", eventId)).toEqual([]);

    // The song TITLES are the artistic content itself — the count is the news.
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    expect((rows[0]?.summary as { itemCount: number }).itemCount).toBe(2);
    expect(JSON.stringify(rows[0]?.summary)).not.toContain("Opener");
  });
});

describe("event history — the consent moments are reconstructable", () => {
  it("names WHICH party confirmed a deal, how far along the signatures are, and when the terms froze", async () => {
    const operatorProfileId = await seedActor("con-op", "operator");
    const performerProfileId = await seedActor("con-perf", "performer");
    const bystanderProfileId = await seedActor("con-bystander", "performer");
    const { eventId, hostParticipantId } = await seedEventWithHost(
      "Consent Night",
      operatorProfileId,
      "con-op",
    );
    const performerParticipantId = await addParticipant(
      eventId,
      performerProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await addParticipant(
      eventId,
      bystanderProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const deal = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/deals`,
      headers: auth("con-op"),
      payload: {
        type: "performance",
        name: "Guarantee",
        guaranteeAmount: "500000",
        parties: [
          { participantId: hostParticipantId, roleInDeal: "payer" },
          { participantId: performerParticipantId, roleInDeal: "payee" },
        ],
      },
    });
    expect(deal.statusCode).toBe(201);
    const dealId = deal.json().id as string;

    // Terms move BEFORE anyone signs — the change the parties are entitled to see.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("con-op"),
      payload: { guaranteeAmount: "600000" },
    });
    expect(patched.statusCode).toBe(200);

    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/send`,
      headers: auth("con-op"),
    });
    expect(sent.statusCode).toBe(200);

    const firstSignature = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/confirm`,
      headers: auth("con-op"),
    });
    expect(firstSignature.statusCode).toBe(200);

    const secondSignature = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/confirm`,
      headers: auth("con-perf"),
    });
    expect(secondSignature.statusCode).toBe(200);

    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));

    // The terms change is history, and it names the FIELD, never the figure.
    const updated = rows.find((row) => row.type === "deal.updated");
    expect((updated?.summary as { fields: string[] }).fields).toEqual(["guaranteeAmount"]);
    expect(JSON.stringify(updated?.summary)).not.toContain("600000");

    // Signature one: how far along the signatures are, and that nothing froze yet.
    const partial = rows.find((row) => row.type === "deal.party_confirmed");
    const partialSummary = partial?.summary as {
      confirmedCount: number;
      signatoryCount: number;
      termsFrozen: boolean;
    };
    expect(partialSummary.confirmedCount).toBe(1);
    expect(partialSummary.signatoryCount).toBe(2);
    expect(partialSummary.termsFrozen).toBe(false);

    // Signature two: the moment the snapshot was taken.
    const full = rows.find((row) => row.type === "deal.confirmed");
    expect((full?.summary as { termsFrozen: boolean }).termsFrozen).toBe(true);

    // The division of labour, asserted rather than assumed. The FEED carries what a
    // person can read — a rollup, a name in `actor_display`, and no uuid. The AUDIT
    // carries which party line each signature stamped, which is what a dispute needs
    // and what nobody needs to see in a timeline.
    expect(JSON.stringify(rows.map((row) => row.summary))).not.toContain(performerParticipantId);
    const confirmAudits = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.eventId, eventId), eq(schema.auditLog.action, "deal.confirm")));
    const boundParties = confirmAudits.flatMap(
      (row) =>
        ((row.changes as { after?: { confirmedParticipantIds?: string[] } })?.after
          ?.confirmedParticipantIds ?? []) as string[],
    );
    expect(boundParties.sort()).toEqual([hostParticipantId, performerParticipantId].sort());

    // …and the frozen terms themselves are on the deal, so "who agreed to what" is
    // the activity row plus `confirmed_snapshot`, with no re-derivation needed.
    const [frozen] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect(frozen?.confirmedSnapshot).toBeTruthy();

    // The third act on the bill is party to nothing, so none of it is theirs.
    expect(await visibleTypes("con-bystander", eventId)).toEqual([]);
  });
});

describe("event history — one event, three viewpoints", () => {
  /**
   * Job 3's question, asked once with everything on the table: an operator, a
   * performer and a crew member on the SAME event, every new activity kind present,
   * and the whole feed read back as each of them.
   *
   * The interesting assertion is not what the operator sees — it is the two lists
   * below it. A history entry with the wrong `targetKind` is a back door around the
   * ceiling `isGrantable()` enforces on the resource, and the only way to catch one
   * is to read the feed as the person who must not see it.
   */
  it("gives the operator the whole story, the performer their own, and the crew the running order", async () => {
    const operatorProfileId = await seedActor("view-op", "operator");
    const performerProfileId = await seedActor("view-perf", "performer");
    const crewProfileId = await seedActor("view-crew", "performer");
    const { eventId, hostParticipantId } = await seedEventWithHost(
      "Three Viewpoints",
      operatorProfileId,
      "view-op",
    );
    const performerParticipantId = await addParticipant(
      eventId,
      performerProfileId,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await addParticipant(eventId, crewProfileId, "crew", PRESET_PERMISSION_SETS.crew_technical);

    // ── the operator's pool work ──────────────────────────────────────────────
    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth("view-op"),
      payload: { scope: "shared" },
    });
    expect(budget.statusCode).toBe(201);
    const budgetLine = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budget.json().id}/lines`,
      headers: auth("view-op"),
      payload: {
        kind: "revenue",
        label: "Bar take",
        amount: "240000",
        collectedBy: hostParticipantId,
      },
    });
    expect(budgetLine.statusCode).toBe(201);

    // ── the running order, and a job on the list ──────────────────────────────
    const scheduled = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/schedule`,
      headers: auth("view-op"),
      payload: { localDateTime: "2026-10-01T17:00:00", label: "Load-in" },
    });
    expect(scheduled.statusCode).toBe(201);
    const task = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth("view-op"), "x-profile-id": operatorProfileId },
      payload: { title: "Hire the PA", eventId },
    });
    expect(task.statusCode).toBe(201);

    // ── the act's own material ────────────────────────────────────────────────
    const library = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performerProfileId}/riders`,
      headers: auth("view-perf"),
      payload: { type: "tech", name: "Backline" },
    });
    expect(library.statusCode).toBe(201);
    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/riders`,
      headers: auth("view-perf"),
      payload: { sourceRiderId: library.json().id },
    });
    expect(attached.statusCode).toBe(201);
    const setlist = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${eventId}/setlists`,
      headers: auth("view-perf"),
      payload: { items: [{ title: "Secret song" }] },
    });
    expect(setlist.statusCode).toBe(200);

    // ── the money between them ────────────────────────────────────────────────
    const deal = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/deals`,
      headers: auth("view-op"),
      payload: {
        type: "performance",
        name: "Fee",
        guaranteeAmount: "300000",
        parties: [
          { participantId: hostParticipantId, roleInDeal: "payer" },
          { participantId: performerParticipantId, roleInDeal: "payee" },
        ],
      },
    });
    expect(deal.statusCode).toBe(201);
    const repriced = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.json().id}`,
      headers: auth("view-op"),
      payload: { guaranteeAmount: "350000" },
    });
    expect(repriced.statusCode).toBe(200);

    // ── viewpoint 1: the operator administers the event, and sees all of it ───
    expect(await visibleTypes("view-op", eventId)).toEqual([
      "budget.created",
      "budget.line_added",
      "deal.created",
      "deal.updated",
      "rider.attached",
      "schedule.created",
      "setlist.updated",
      "task.created",
    ]);

    // ── viewpoint 2: the performer — their own material, their own deal, the
    // event-level news. NOT the budget: `budget.view` is the ceiling on the pool.
    expect(await visibleTypes("view-perf", eventId)).toEqual([
      "deal.created",
      "deal.updated",
      "rider.attached",
      "schedule.created",
      "setlist.updated",
      "task.created",
    ]);

    // ── viewpoint 3: technical crew — the running order and the job list, and
    // nothing else. They hold `rider.view`, but reach over a rider is decided by
    // their SPONSOR, so the feed refuses rather than guess (deny-by-default).
    expect(await visibleTypes("view-crew", eventId)).toEqual(["schedule.created", "task.created"]);

    // The margin, the fee and the song title are absent from every summary on the
    // event — not merely hidden from a tier, never written at all.
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, eventId));
    const everySummary = JSON.stringify(rows.map((row) => row.summary));
    expect(everySummary).not.toContain("240000");
    expect(everySummary).not.toContain("350000");
    expect(everySummary).not.toContain("Secret song");

    // …and the general rule behind those three, so a future writer is caught by the
    // rule rather than by whichever amount this test happens to use.
    for (const row of rows) expectNoMoneyFigure(row.summary);
  });
});

/**
 * `lib/activity.ts` forbids money in a summary absolutely — an amount in a `deal`
 * or `settlement` row would hand a performer a figure the serializer redacts from
 * the resource itself. This is that rule as an assertion.
 *
 * It walks the VALUES, and it skips uuid-shaped strings before looking for a run of
 * digits. That distinction is the whole point: a bare `/\d{5,}/` over the serialized
 * summary cannot tell `150000` from the `75053` sitting inside a random uuid, so it
 * fails perhaps half the time on a summary that carries an id — and the tempting fix
 * is to loosen the pattern until it passes, which is how a real amount gets in six
 * months later. Ids are legitimate in a summary (`participant.added` has carried
 * `profileId` since it was written); money is not. Check the right thing instead.
 */
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectNoMoneyFigure(summary: unknown): void {
  if (summary == null) return;
  if (typeof summary === "bigint") throw new Error(`money in an activity summary: ${summary}`);
  if (typeof summary === "number") {
    // Counts and versions are small and legitimate ("1 of 2 parties confirmed");
    // minor units are not. The same threshold the string branch uses.
    expect(Math.abs(summary)).toBeLessThan(10_000);
    return;
  }
  if (typeof summary === "string") {
    if (UUID_SHAPED.test(summary)) return;
    expect(summary).not.toMatch(/\d{5,}/);
    return;
  }
  if (Array.isArray(summary)) {
    for (const entry of summary) expectNoMoneyFigure(entry);
    return;
  }
  if (typeof summary === "object") {
    for (const value of Object.values(summary as Record<string, unknown>)) {
      expectNoMoneyFigure(value);
    }
  }
}
