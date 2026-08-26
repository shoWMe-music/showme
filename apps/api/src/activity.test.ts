import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { activityRoutes } from "./routes/activity";
import { dealRoutes } from "./routes/deals";
import { eventRoutes } from "./routes/events";
import { holdRoutes } from "./routes/holds";
import { participantRoutes } from "./routes/participants";
import { scheduleRoutes } from "./routes/schedule";
import { buildTestApp } from "./testing";

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
    dealRoutes,
    participantRoutes,
    eventRoutes,
    holdRoutes,
    scheduleRoutes,
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
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
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
