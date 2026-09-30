import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { eventListRoutes } from "./routes/events-list";
import { buildTestApp } from "./testing";

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

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + profile + active membership + a permission set, return the ids. */
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
  return { profileId: profile.id, permissionSetId: set.id };
}

/** Insert an event hosted by `profileId`, with that profile as a host participant. */
async function seedHostedEvent(
  title: string,
  host: { profileId: string; permissionSetId: string },
  createdBy: string,
  extra: Record<string, unknown> = {},
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({ hostProfileId: host.profileId, title, baseCurrency: "SEK", createdBy, ...extra })
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

describe("GET /events — access-scoped list", () => {
  it("returns only the caller's events, not one they are not on", async () => {
    const caller = await seedMemberWithSet(
      "ls-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const stranger = await seedMemberWithSet(
      "ls-other",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const mine1 = await seedHostedEvent("Mine A", caller, "ls-op");
    const mine2 = await seedHostedEvent("Mine B", caller, "ls-op");
    await seedHostedEvent("Not Mine", stranger, "ls-other");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("ls-op"),
    });
    expect(response.statusCode).toBe(200);
    const ids = new Set(response.json().items.map((event: { id: string }) => event.id));
    expect(ids.has(mine1.id)).toBe(true);
    expect(ids.has(mine2.id)).toBe(true);
    expect(ids.size).toBe(2); // never the stranger's event
  });

  /**
   * SHOW-DATE ORDER, AND THE CURSOR THAT HAS TO AGREE WITH IT (ClickUp `123qy9rpe3y`).
   *
   * The list used to be ordered by when a row was CREATED, which is an accident of data
   * entry: an event typed in yesterday for next March sat above one typed last month for
   * this Friday. The order and the keyset are one decision — sorting in the client would
   * page wrongly the moment there is a second page — so both are asserted here, and the
   * paging half is asserted one row at a time, which is the only way a keyset can be
   * caught skipping or repeating.
   */
  it("orders by show date, newest night first, with undated shows last", async () => {
    const caller = await seedMemberWithSet(
      "order-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    // Seeded in an order that is NOT the answer, so a list that simply echoed
    // insertion order would fail.
    await seedHostedEvent("Middle", caller, "order-op", { eventDate: "2026-06-15" });
    await seedHostedEvent("Undated", caller, "order-op");
    await seedHostedEvent("Latest", caller, "order-op", { eventDate: "2027-03-01" });
    await seedHostedEvent("Earliest", caller, "order-op", { eventDate: "2025-01-05" });

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("order-op"),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((event: { title: string }) => event.title)).toEqual([
      "Latest",
      "Middle",
      "Earliest",
      "Undated",
    ]);

    // And the same order across page boundaries, one row at a time — including the
    // step from the last dated row into the undated block, which is the join the
    // keyset has to name explicitly.
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const url: string = cursor
        ? `/api/v1/events?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/v1/events?limit=1";
      const response = await app.inject({ method: "GET", url, headers: auth("order-op") });
      expect(response.statusCode).toBe(200);
      walked.push(...response.json().items.map((event: { title: string }) => event.title));
      cursor = response.json().nextCursor;
    }
    expect(walked).toEqual(["Latest", "Middle", "Earliest", "Undated"]);
    expect(cursor).toBeNull();
  });

  it("respects limit and returns a nextCursor when truncated", async () => {
    const caller = await seedMemberWithSet(
      "pg-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Page 1", caller, "pg-op");
    await seedHostedEvent("Page 2", caller, "pg-op");

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/events?limit=1",
      headers: auth("pg-op"),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toBeTypeOf("string");

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/events?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: auth("pg-op"),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    // Distinct pages.
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
  });

  it("filters by a single status, server-side", async () => {
    const caller = await seedMemberWithSet(
      "st-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const draft = await seedHostedEvent("Shelved", caller, "st-op", { status: "draft" });
    await seedHostedEvent("Locked in", caller, "st-op", { status: "confirmed" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=draft",
      headers: auth("st-op"),
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as { id: string; status: string }[];
    expect(items.map((event) => event.id)).toEqual([draft.id]);
  });

  // The UI's "Pending" chip means pending OR suggested. Before the list-valued
  // `status` the only honest way to answer it was to filter in the browser —
  // over page one. `?status=pending,suggested` used to be a 400 (not in the enum).
  it("accepts a comma-separated status list, so one chip is one query", async () => {
    const caller = await seedMemberWithSet(
      "stl-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const pending = await seedHostedEvent("Awaiting reply", caller, "stl-op", {
      status: "pending",
    });
    const suggested = await seedHostedEvent("Offered", caller, "stl-op", { status: "suggested" });
    await seedHostedEvent("Locked in", caller, "stl-op", { status: "confirmed" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,suggested",
      headers: auth("stl-op"),
    });
    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as { id: string }[]).map((event) => event.id);
    expect(new Set(ids)).toEqual(new Set([pending.id, suggested.id]));

    // The browser sends it percent-encoded (`URLSearchParams` escapes the comma),
    // so the same query has to survive that spelling too.
    const encoded = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending%2Csuggested",
      headers: auth("stl-op"),
    });
    expect(encoded.statusCode).toBe(200);
    expect((encoded.json().items as { id: string }[]).map((event) => event.id).sort()).toEqual(
      ids.sort(),
    );
  });

  it("keeps the status filter across pages, so page two is still filtered", async () => {
    const caller = await seedMemberWithSet(
      "stp-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const first = await seedHostedEvent("Offer one", caller, "stp-op", { status: "suggested" });
    const second = await seedHostedEvent("Offer two", caller, "stp-op", { status: "pending" });
    await seedHostedEvent("Not in this filter", caller, "stp-op", { status: "confirmed" });

    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,suggested&limit=1",
      headers: auth("stp-op"),
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().nextCursor).toBeTypeOf("string");

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/events?status=pending,suggested&limit=1&cursor=${encodeURIComponent(page1.json().nextCursor)}`,
      headers: auth("stp-op"),
    });
    expect(page2.statusCode).toBe(200);
    const seen = [page1.json().items[0].id, page2.json().items[0].id];
    expect(new Set(seen)).toEqual(new Set([first.id, second.id]));
    // The confirmed event never appears, on either page.
    expect(page2.json().nextCursor).toBeNull();
  });

  it("rejects a status that is not an event status", async () => {
    await seedMemberWithSet("stx-op", "operator", PRESET_PERMISSION_SETS.operator_full);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,not_a_status",
      headers: auth("stx-op"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not_a_status");
  });

  it("serializes operator-only fields for the caller", async () => {
    const caller = await seedMemberWithSet(
      "sr-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Rank Night", caller, "sr-op");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("sr-op"),
    });
    expect(response.statusCode).toBe(200);
    // operator holds event.edit → hold fields present in the shape.
    expect(response.json().items[0]).toHaveProperty("holdAutoPromote");
  });
});

/**
 * CHANGED DELIBERATELY, 2026-08-31. These two used to delete an event with no
 * preconditions beyond `event.delete` and an optimistic lock, and with no acting
 * profile at all — which is what the route was, and it was wrong twice over: it
 * destroyed every other party's record of the show, and it 500'd on any event
 * that had ever been budgeted (`lib/event-delete.ts` has the measurement). The
 * contract is now "only while it is nobody's record but yours", reached from the
 * ARCHIVE — so both tests act as the host profile and file the show away first.
 * The whole rule is exercised in `events-archive.test.ts`; what these two still
 * guard is the audit trail surviving the row it describes (A-11).
 */
describe("DELETE /events/:id", () => {
  it("deletes an event and writes an audit row", async () => {
    const { db } = harness;
    const caller = await seedMemberWithSet(
      "del-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Doomed", caller, "del-op");
    const headers = { ...auth("del-op"), "x-profile-id": caller.profileId };
    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/archive`,
      headers,
    });
    expect(archived.statusCode).toBe(200);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().deleted).toBe(true);

    const rows = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(rows).toHaveLength(0);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, event.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("event.delete");
  });

  // A-11: `POST /events` writes an audit row pinning the event it created, and
  // `audit_log.event_id` used to carry a foreign key — so every event created
  // through the API was undeletable (500) from the moment it existed. Seeding an
  // event straight into the table (as the test above does) never produced that
  // audit row, which is why nothing caught it.
  it("deletes an event created through the API, and the audit trail survives it", async () => {
    const { db } = harness;
    await db.insert(schema.users).values({
      id: "api-del-op",
      email: "api-del-op@example.showme.test",
      kind: "operator",
    });
    const [profile] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "api-del-op",
        name: "api-del-op",
        slug: "api-del-op",
      })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: "api-del-op", role: "owner", status: "active" });

    const headers = { authorization: "Bearer api-del-op", "x-profile-id": profile.id };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Created then deleted", baseCurrency: "SEK" },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id;

    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/archive`,
      headers,
    });
    expect(archived.statusCode).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}`,
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect(await db.select().from(schema.events).where(eq(schema.events.id, eventId))).toHaveLength(
      0,
    );

    // Both rows are still there, and both still name the event they describe.
    const trail = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, eventId));
    // `event.archive` is in the trail because deleting now goes through the
    // archive — that IS the flow, and its audit row must survive the deletion for
    // the same reason the other two do.
    expect(trail.map((row) => row.action).sort()).toEqual([
      "event.archive",
      "event.create",
      "event.delete",
    ]);
  });

  it("forbids a caller without event.delete (403)", async () => {
    const operator = await seedMemberWithSet(
      "fb-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "fb-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Guarded", operator, "fb-op");
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: auth("fb-perf"),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("POST /events/:id/publish", () => {
  it("publishes the event and bumps the version to 2", async () => {
    const caller = await seedMemberWithSet(
      "pub-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Confirmed Night", caller, "pub-op", {
      status: "confirmed",
      eventDate: "2026-09-12",
    });
    expect(event.published).toBe(false);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().published).toBe(true);
    expect(response.json().version).toBe(2);

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, event.id), eq(schema.auditLog.action, "event.publish")),
      );
    expect(audit).toHaveLength(1);
  });

  it("refuses to publish an unconfirmed event and leaves the flag down", async () => {
    const caller = await seedMemberWithSet(
      "pub-draft-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Draft Night", caller, "pub-draft-op", {
      status: "draft",
      eventDate: "2026-09-12",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-draft-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/confirmed/i);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
    expect(after?.version).toBe(1);
  });

  /**
   * FLIPPED BY A RULING, NOT A DRIFT — decisions §25.9.2, Daniel 2026-09-29.
   *
   * This asserted the opposite, on Ran's ClickUp `123qy9rpe3q`: *"The performer should also have
   * the option to publish or unpublish from their page."* Daniel has overruled it in as many
   * words — **"Only the host can publish an event"** — and the competing interest the preset's own
   * comment had already named is the one that won: a venue has a legitimate interest in a date not
   * being announced before it is ready, and an early announcement cannot be taken back.
   *
   * The assertion is kept rather than deleted, because a performer standing on a confirmed event
   * with the full `performer` preset is precisely the shape the old rule allowed — so it is the
   * only test that can catch the ruling being quietly undone.
   */
  it("refuses a PERFORMER the publish their preset used to carry (§25.9.2)", async () => {
    const operator = await seedMemberWithSet(
      "pub-perf-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pub-perf-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Act's Own Night", operator, "pub-perf-op", {
      status: "confirmed",
      eventDate: "2026-11-02",
    });
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-perf-act"),
    });
    expect(response.statusCode).toBe(403);

    // AND THE EVENT REALLY IS STILL DOWN. A 403 with a published row behind it would be the worst
    // of both — the refusal is about the announcement, not about the response code.
    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);

    // Nobody is told about an announcement that did not happen.
    expect(
      await harness.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, "pub-perf-op")),
    ).toHaveLength(0);
  });

  /**
   * FLIPPED BY THE SAME RULING — decisions §25.9.2.
   *
   * This asserted that a represented act publishes THROUGH ITS AGENT, and the reasoning was sound
   * while publishing was the act's option to exercise: delegation moves the business-action
   * capabilities to the agent, so publishing went with them, and otherwise the one seeded act with
   * representation was the one act that could not be announced by its own side.
   *
   * "Only the host can publish an event" removes the asymmetry rather than resolving it — neither
   * side holds it now, so there is nothing for delegation to move. Both halves still assert, and
   * both are now refusals.
   */
  it("refuses the AGENT and the delegated act alike (§25.9.2)", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "pub-del-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pub-del-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const agent = await seedMemberWithSet(
      "pub-del-agent",
      "performer",
      PRESET_PERMISSION_SETS.agent,
    );
    const event = await seedHostedEvent("Represented Night", operator, "pub-del-op", {
      status: "confirmed",
      eventDate: "2026-11-09",
    });
    const [performerParticipant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        status: "confirmed",
      })
      .returning();
    if (!performerParticipant) throw new Error("participant seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: agent.profileId,
      role: "agent",
      permissionSetId: agent.permissionSetId,
      status: "confirmed",
    });
    // Authority is resolved against the REPRESENTATION, not the stamp alone, so the
    // fixture needs both to be a real state (see `riders.test.ts` for the same shape).
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: performer.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });
    await db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(eq(schema.eventParticipants.id, performerParticipant.id));

    // The act itself has no band while delegated — this is delegation working, not a
    // bug, and it is why the agent needs the capability.
    const byAct = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-del-act"),
    });
    expect(byAct.statusCode).toBe(403);

    const byAgent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-del-agent"),
    });
    expect(byAgent.statusCode).toBe(403);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
  });

  it("refuses a performer whose permission set does not carry event.publish", async () => {
    const operator = await seedMemberWithSet(
      "pub-narrow-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "pub-narrow-act",
      "performer",
      // The floor, minus publishing — an operator handing over a tighter set. This is
      // why `event.publish` is in the PRESET and not in `PERFORMER_FLOOR`.
      PRESET_PERMISSION_SETS.view_only,
    );
    const event = await seedHostedEvent("Narrow Night", operator, "pub-narrow-op", {
      status: "confirmed",
      eventDate: "2026-11-03",
    });
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-narrow-act"),
    });
    expect(response.statusCode).toBe(403);
    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
  });
});

/**
 * UNPUBLISH — the same capability as its opposite (ClickUp `123qy9rpe3q`).
 *
 * Taking a page down was `PATCH { published: false }`, which needs `event.edit` — the title, the
 * date, the venue, the capacity — so it needed a route of its own.
 *
 * THE ACTOR HERE IS NOW A CO-HOST, not the performer, because §25.9.2 made announcing the event an
 * operator act and the two directions share one capability. What these cases are ABOUT is unchanged
 * — that taking a page down is audited and that the other operator hears — so the actor changed and
 * the assertions did not. A co-host rather than the host, deliberately: it keeps "tells the
 * operator" a real assertion (the host is the one told) and it exercises §25.7.4's handover, which
 * is the only way anybody but the creator publishes now.
 */
describe("POST /events/:id/unpublish", () => {
  async function publishedSharedEvent(prefix: string) {
    const operator = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const coHost = await seedMemberWithSet(
      `${prefix}-co`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      `${prefix}-act`,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent(`${prefix} night`, operator, `${prefix}-op`, {
      status: "confirmed",
      eventDate: "2026-11-04",
      published: true,
    });
    await harness.db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        status: "confirmed",
      },
      {
        eventId: event.id,
        profileId: coHost.profileId,
        role: "co_host",
        permissionSetId: coHost.permissionSetId,
        status: "confirmed",
      },
    ]);
    return { operator, coHost, performer, event };
  }

  /*
   * AND THE PERFORMER CANNOT — the other half of §25.9.2, asserted on the direction people forget.
   * A ruling about publishing that left UNPUBLISHING open would be half a ruling, and the two share
   * one capability, so this is the test that says the sharing is deliberate rather than lucky.
   */
  it("refuses a performer the unpublish, not only the publish (§25.9.2)", async () => {
    const { event } = await publishedSharedEvent("unpub-act-refused");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unpublish`,
      headers: auth("unpub-act-refused-act"),
    });
    expect(response.statusCode).toBe(403);
    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(true);
  });

  it("takes the page down for a performer, audits it, and tells the operator", async () => {
    const { event } = await publishedSharedEvent("unpub");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unpublish`,
      headers: auth("unpub-co"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().published).toBe(false);

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, event.id), eq(schema.auditLog.action, "event.unpublish")),
      );
    expect(audit).toHaveLength(1);

    const bell = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "unpub-op"));
    expect(bell).toHaveLength(1);
    expect(bell[0]?.type).toBe("event.unpublished");
  });

  it("says nothing when the page was already down — an idempotent no-op is not news", async () => {
    const operator = await seedMemberWithSet(
      "unpub-dark-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    // A co-host, for the reason the describe block gives: publishing is an operator act (§25.9.2).
    const coHost = await seedMemberWithSet(
      "unpub-dark-co",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Already dark", operator, "unpub-dark-op", {
      status: "confirmed",
      eventDate: "2026-11-05",
    });
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: coHost.profileId,
      role: "co_host",
      permissionSetId: coHost.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unpublish`,
      headers: auth("unpub-dark-co"),
    });
    expect(response.statusCode).toBe(200);
    expect(
      await harness.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, "unpub-dark-op")),
    ).toHaveLength(0);
  });

  it("refuses a reader without event.publish", async () => {
    const { event } = await publishedSharedEvent("unpub-narrow");
    const stranger = await seedMemberWithSet(
      "unpub-narrow-viewer",
      "performer",
      PRESET_PERMISSION_SETS.view_only,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: stranger.profileId,
      role: "support",
      permissionSetId: stranger.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/unpublish`,
      headers: auth("unpub-narrow-viewer"),
    });
    expect(response.statusCode).toBe(403);
    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(true);
  });

  /**
   * The THIRD door. Every operator screen has always taken a page down with a PATCH,
   * and a notification attached only to the two dedicated routes would skip it in
   * silence — the same shape the cancel work walked into an hour earlier.
   */
  it("notifies from the PATCH path too, which is how the operator's screen does it", async () => {
    const { event } = await publishedSharedEvent("unpub-patch");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("unpub-patch-op"),
      payload: { published: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().published).toBe(false);

    const bell = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "unpub-patch-act"));
    expect(bell).toHaveLength(1);
    expect(bell[0]?.type).toBe("event.unpublished");
  });
});

describe("POST /events/:id/publish — preconditions", () => {
  it("refuses to publish a dateless event — a poster with no date is not an announcement", async () => {
    const caller = await seedMemberWithSet(
      "pub-nodate-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Someday Show", caller, "pub-nodate-op", {
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-nodate-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/date/i);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
  });
});

describe("POST /events/:id/notify", () => {
  it("queues (stub) and audits event.notify", async () => {
    const caller = await seedMemberWithSet(
      "not-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Announce", caller, "not-op");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/notify`,
      headers: auth("not-op"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ queued: true });

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, event.id), eq(schema.auditLog.action, "event.notify")),
      );
    expect(audit).toHaveLength(1);
  });
});

describe("PATCH /events/:id — the poster (migration 0026)", () => {
  /**
   * A file row + the storage path the API insists on, exactly as
   * `POST /files/upload-url` would have written them. Inserted directly because
   * this suite does not mount the files routes — the rule under test is what the
   * EVENT does with a file id, not how the id was minted.
   */
  async function seedUploadedImage(profileId: string, ownerUserId: string, name: string) {
    const [file] = await harness.db
      .insert(schema.files)
      .values({
        ownerUserId,
        ownerProfileId: profileId,
        kind: "photo",
        path: `profiles/${profileId}/media/${name}`,
        contentType: "image/png",
        sizeBytes: 4096,
      })
      .returning();
    if (!file) throw new Error("file seed failed");
    return file;
  }

  it("attaches a poster the host uploaded, and serves it as a signed URL", async () => {
    const host = await seedMemberWithSet("poster-host", "operator", ["event.view", "event.edit"]);
    const event = await seedHostedEvent("Poster Show", host, "poster-host");
    const file = await seedUploadedImage(host.profileId, "poster-host", "poster.png");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-host"),
      payload: { imageFileId: file.id },
    });
    expect(saved.statusCode).toBe(200);
    // The WIRE carries a URL minted per read FROM THE FILE'S PATH — this suite's
    // signer is the offline fake, so the assertion is on the shape rather than on
    // a real signature. What it proves is that the response went through the
    // signer at all, which is the half that used to be missing.
    expect(saved.json().imageUrl).toBe(
      `https://fake.storage.local/download/${encodeURIComponent(file.path)}`,
    );

    // The ROW stores the FILE. Storing the signed URL instead would give the show
    // a poster that works for fifteen minutes.
    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.imageFileId).toBe(file.id);
    expect(row?.imageUrl).toBeNull();
  });

  it("refuses a poster uploaded to a different profile", async () => {
    const host = await seedMemberWithSet("poster-mine", "operator", ["event.view", "event.edit"]);
    const stranger = await seedMemberWithSet("poster-theirs", "operator", ["event.view"]);
    const event = await seedHostedEvent("Borrowed Poster", host, "poster-mine");
    const theirs = await seedUploadedImage(stranger.profileId, "poster-theirs", "theirs.png");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-mine"),
      payload: { imageFileId: theirs.id },
    });
    // 400, not 403: the caller may edit this event. The file is the problem, and
    // the message says which one.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not uploaded to this profile");

    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.imageFileId).toBeNull();
  });

  it("takes the poster off when both halves are cleared", async () => {
    const host = await seedMemberWithSet("poster-clear", "operator", ["event.view", "event.edit"]);
    const event = await seedHostedEvent("Cleared Poster", host, "poster-clear", {
      imageUrl: "https://cdn.example/old-poster.png",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-clear"),
      payload: { imageFileId: null, imageUrl: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().imageUrl).toBeNull();
  });
});

describe("PATCH /events/:id — the free-tier event cap (entitlement layer)", () => {
  /** A free_operator host already sitting ON the cap: 3 counted events in the window. */
  async function seedHostAtCap(prefix: string) {
    const host = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Counted A", host, `${prefix}-op`, { status: "confirmed" });
    await seedHostedEvent("Counted B", host, `${prefix}-op`, { status: "confirmed" });
    await seedHostedEvent("Counted C", host, `${prefix}-op`, { status: "concluded" });
    return host;
  }

  it("lets a fourth event reach `confirmed` and `concluded` — events are uncapped", async () => {
    const host = await seedHostAtCap("cap-conc");
    const fourth = await seedHostedEvent("Fourth", host, "cap-conc-op", { status: "draft" });

    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${fourth.id}`,
      headers: auth("cap-conc-op"),
      payload: { status: "confirmed" },
    });
    expect(confirmed.statusCode).toBe(200);

    // The A-20 hole: the SAME event walked into the counted set through `concluded`.
    const concluded = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${fourth.id}`,
      headers: auth("cap-conc-op"),
      payload: { status: "concluded" },
    });
    expect(concluded.statusCode).toBe(200);

    // The state, not only the response: it really is concluded now. This used to
    // assert `draft` — the cap refusing to let it move — which contradicted the
    // "Unlimited events" the Basic plan is sold on.
    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, fourth.id));
    expect(after?.status).toBe("concluded");
  });

  it("still lets an event already inside the counted set conclude, and lets a cancel through", async () => {
    const host = await seedHostAtCap("cap-inside");
    const live = await seedHostedEvent("Live", host, "cap-inside-op", { status: "confirmed" });
    const draft = await seedHostedEvent("Shelved", host, "cap-inside-op", { status: "draft" });

    // confirmed → concluded consumes nothing new: never gated.
    const concluded = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${live.id}`,
      headers: auth("cap-inside-op"),
      payload: { status: "concluded" },
    });
    expect(concluded.statusCode).toBe(200);
    expect(concluded.json().status).toBe("concluded");

    // Leaving the set is never gated either.
    const cancelled = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${draft.id}`,
      headers: auth("cap-inside-op"),
      payload: { status: "cancelled" },
    });
    expect(cancelled.statusCode).toBe(200);
  });

  it("lets a host under the cap conclude a draft", async () => {
    const host = await seedMemberWithSet(
      "cap-under-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Counted A", host, "cap-under-op", { status: "confirmed" });
    const draft = await seedHostedEvent("Next", host, "cap-under-op", { status: "draft" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${draft.id}`,
      headers: auth("cap-under-op"),
      payload: { status: "concluded" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("venue-profile prefill — the venue's own facts fill the blanks", () => {
  /** A venue profile that has actually filled in its own record (migration 0010). */
  async function seedVenueProfile(id: string, name: string) {
    const { db } = harness;
    await db
      .insert(schema.users)
      .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "operator", type: "venue", ownerUserId: id, name, slug: id })
      .returning();
    if (!profile) throw new Error("venue profile seed failed");
    await db.insert(schema.venueDetails).values({
      profileId: profile.id,
      capacity: 420,
      curfew: "02:00",
      amenities: ["green_room", "Loading Dock"],
    });
    await db
      .insert(schema.profileLocations)
      .values({ profileId: profile.id, city: "Stockholm", country: "SE", isPrimary: true });
    return profile.id;
  }

  /**
   * THE ADDRESS AN EVENT SHOWS (ClickUp `123qy9rnfab`).
   *
   * Ran: *"Event manager and details should always show Address and country of
   * the event place… this is for the Performers and agents to know."* The operator
   * who titled the show knows the address by heart; everybody travelling to it
   * does not, and a country decides a flight, a carnet and a tax form.
   *
   * These assert the API half, and they are worth having because the failure is
   * silent in a particular way this codebase has been bitten by twice: a field the
   * response SCHEMA does not declare is stripped by Fastify on the way out, so the
   * serializer looks right, the handler looks right, and the client receives
   * nothing. Two fields on this very route (`venueName`, `capacity`) shipped that
   * way and the comments above them say so.
   */
  it("carries the venue's address and country on the list row", async () => {
    const host = await seedMemberWithSet(
      "loc-list-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("loc-list-venue", "The Lantern Hall");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("loc-list-op"), "x-profile-id": host.profileId },
      payload: { title: "Located", baseCurrency: "SEK", venueProfileId },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: { ...auth("loc-list-op"), "x-profile-id": host.profileId },
    });
    const row = list.json().items.find((item: { title: string }) => item.title === "Located");
    expect(row.venueLocation).toMatchObject({ city: "Stockholm", country: "SE" });
  });

  /**
   * An event that names its room as free text has no address to show, and `null`
   * is the honest answer. Showing the HOST's country instead would be worse than
   * showing none: an operator books abroad, and a performer reading the flag would
   * pack for the wrong country.
   */
  it("says null for an event whose venue is only free text", async () => {
    const host = await seedMemberWithSet(
      "loc-none-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("loc-none-op"), "x-profile-id": host.profileId },
      payload: { title: "Unlocated", baseCurrency: "SEK", venueName: "A field, somewhere" },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: { ...auth("loc-none-op"), "x-profile-id": host.profileId },
    });
    const row = list.json().items.find((item: { title: string }) => item.title === "Unlocated");
    expect(row.venueLocation).toBeNull();
  });

  /**
   * A profile with several addresses and none marked primary has not answered the
   * question. Guessing — the first row, the newest — would show a different
   * address depending on insert order, which is a bug nobody could reproduce.
   */
  it("shows no address when the venue has not said which one is primary", async () => {
    const { db } = harness;
    const host = await seedMemberWithSet(
      "loc-amb-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await db.insert(schema.users).values({
      id: "loc-amb-venue",
      email: "loc-amb-venue@example.showme.test",
      kind: "operator",
    });
    const [venue] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        type: "venue",
        ownerUserId: "loc-amb-venue",
        name: "Two Doors",
        slug: "loc-amb-venue",
      })
      .returning();
    if (!venue) throw new Error("venue seed failed");
    await db.insert(schema.profileLocations).values([
      { profileId: venue.id, city: "Stockholm", country: "SE", isPrimary: false },
      { profileId: venue.id, city: "Berlin", country: "DE", isPrimary: false },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("loc-amb-op"), "x-profile-id": host.profileId },
      payload: { title: "Ambiguous", baseCurrency: "SEK", venueProfileId: venue.id },
    });
    expect(created.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/events/${created.json().id}`,
      headers: { ...auth("loc-amb-op"), "x-profile-id": host.profileId },
    });
    expect(detail.json().venueLocation).toBeNull();
  });

  it("fills name, capacity, curfew, amenities and city on create", async () => {
    const host = await seedMemberWithSet(
      "prefill-create-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-create-venue", "The Lantern Hall");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-create-op"), "x-profile-id": host.profileId },
      payload: { title: "Prefilled", baseCurrency: "SEK", venueProfileId },
    });

    expect(response.statusCode).toBe(201);
    const event = response.json();
    expect(event.venueName).toBe("The Lantern Hall");
    expect(event.capacity).toBe(420);
    expect(event.curfew).toBe("02:00:00");
    expect(event.extras.amenities).toEqual(["green_room", "Loading Dock"]);
    expect(event.extras.city).toBe("Stockholm");
    expect(event.extras.country).toBe("SE");
  });

  it("never overwrites what the operator typed", async () => {
    const host = await seedMemberWithSet(
      "prefill-typed-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-typed-venue", "The Lantern Hall");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-typed-op"), "x-profile-id": host.profileId },
      payload: {
        title: "Seated night",
        baseCurrency: "SEK",
        venueProfileId,
        venueName: "The Lantern Hall (Back Room)",
        capacity: 80,
        curfew: "23:00",
        extras: { amenities: ["Piano"], city: "Uppsala" },
      },
    });

    expect(response.statusCode).toBe(201);
    const event = response.json();
    expect(event.venueName).toBe("The Lantern Hall (Back Room)");
    expect(event.capacity).toBe(80);
    expect(event.curfew).toBe("23:00:00");
    expect(event.extras.amenities).toEqual(["Piano"]);
    expect(event.extras.city).toBe("Uppsala");
    // The country was blank in both, so the venue still gets to fill THAT one.
    expect(event.extras.country).toBe("SE");
  });

  it("fills the blanks when a venue is attached later, and leaves filled fields alone", async () => {
    const host = await seedMemberWithSet(
      "prefill-patch-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-patch-venue", "The Lantern Hall");
    const event = await seedHostedEvent("Venue later", host, "prefill-patch-op", { capacity: 80 });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-patch-op"),
      payload: { venueProfileId },
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json();
    // Blank before → the venue's own answer.
    expect(updated.venueName).toBe("The Lantern Hall");
    expect(updated.curfew).toBe("02:00:00");
    expect(updated.extras.amenities).toEqual(["green_room", "Loading Dock"]);
    // Already set → untouched.
    expect(updated.capacity).toBe(80);
  });

  it("does not re-prefill on an unrelated edit once the operator has cleared a field", async () => {
    const host = await seedMemberWithSet(
      "prefill-cleared-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-cleared-venue", "The Lantern Hall");
    const event = await seedHostedEvent("Cleared", host, "prefill-cleared-op", { venueProfileId });

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-cleared-op"),
      payload: { capacity: null, title: "Cleared capacity" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().capacity).toBeNull();

    // A later title edit does not touch the venue link, so nothing is re-read.
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-cleared-op"),
      payload: { title: "Still cleared" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().capacity).toBeNull();
  });

  it("survives a venue that has written nothing down", async () => {
    const host = await seedMemberWithSet(
      "prefill-bare-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const bare = await seedMemberWithSet(
      "prefill-bare-venue",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-bare-op"), "x-profile-id": host.profileId },
      payload: { title: "Bare venue", baseCurrency: "SEK", venueProfileId: bare.profileId },
    });

    expect(response.statusCode).toBe(201);
    // The profile still has a NAME, which is the one fact every profile has.
    expect(response.json().venueName).toBe("prefill-bare-venue");
    expect(response.json().capacity).toBeNull();
  });
});

describe("PATCH /events/:id — a solo operator drives the status themselves", () => {
  // The counterparty-consent rules in this product live on the DEAL (each party
  // confirms its own `deal_parties` row) and on the INVITATION (nothing is
  // granted until the invitee accepts). The EVENT's status has never been a
  // handshake — it is the operator's own record of where the booking stands, and
  // an operator working alone must be able to say so. This locks that in, so a
  // future "tighten the transitions" change has to argue with a test.
  it("walks draft → suggested → pending → confirmed → concluded with no counterparty", async () => {
    const host = await seedMemberWithSet(
      "solo-status-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Solo run", host, "solo-status-op", {
      eventDate: "2026-12-01",
    });

    for (const status of ["suggested", "pending", "confirmed", "concluded"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${event.id}`,
        headers: auth("solo-status-op"),
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(status);
    }
  });

  it("lets the operator correct a status BACKWARDS (onboarding a past booking)", async () => {
    const host = await seedMemberWithSet(
      "solo-back-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Mistyped", host, "solo-back-op", { status: "confirmed" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("solo-back-op"),
      payload: { status: "pending" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("pending");
  });

  it("records the move as its own history line, not a generic update", async () => {
    const host = await seedMemberWithSet(
      "solo-history-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Tracked", host, "solo-history-op", {});

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("solo-history-op"),
      payload: { status: "confirmed" },
    });

    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, event.id));
    const statusLine = rows.find((row) => row.type === "event.status_changed");
    expect(statusLine).toBeDefined();
    expect(statusLine?.summary).toMatchObject({ from: "draft", to: "confirmed" });
  });
});

/**
 * The list row's own facts.
 *
 * Every one of these was an em-dash on `/events` while the same event's detail
 * page showed the value in full — three of them because the row had nothing to
 * draw, and `capacity` because `EventResponse` never declared a field
 * `serializeEvent` was already returning, so Fastify stripped it on the way out.
 * That is the same failure that hid `venueName`, which is why both are asserted
 * here: a schema that silently drops a field is invisible until someone reads the
 * screen.
 */
describe("GET /events — free-text search (ClickUp 123qy9rngbp)", () => {
  /**
   * Ran: *"add a search bar … to find something fast based on Performer's name,
   * event date, etc."* The three things a person remembers about a show are what
   * it was called, where it was, and who played, so the search covers all three.
   *
   * SERVER-SIDE deliberately. This list is keyset-paginated; a filter in the
   * browser would search only the page already loaded, so a performer on page two
   * would come back "not found". These assert the whole list is searched.
   *
   * Seeded ONCE — `seedMemberWithSet` mints users at fixed ids, so seeding per
   * test collides on `users_pkey`. Every case below is a read, so one fixture
   * serves them all.
   */
  beforeAll(async () => {
    const caller = await seedMemberWithSet(
      "search-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const act = await seedMemberWithSet(
      "search-act",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "search-act-2",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await harness.db
      .update(schema.profiles)
      .set({ name: "Marlo Vance" })
      .where(eq(schema.profiles.id, act.profileId));
    await harness.db
      .update(schema.profiles)
      .set({ name: "Marlo Support" })
      .where(eq(schema.profiles.id, support.profileId));

    await seedHostedEvent("Spring Warmup", caller, "search-op", { venueName: "The Lantern Hall" });
    const withAct = await seedHostedEvent("Album Release", caller, "search-op", {
      venueName: "Funkhaus",
    });
    // TWO participants whose names match "Marlo", on ONE event. A join would emit
    // the event twice and break the keyset cursor; the EXISTS keeps it at one.
    await harness.db.insert(schema.eventParticipants).values([
      { eventId: withAct.id, profileId: act.profileId, role: "performer", status: "confirmed" },
      { eventId: withAct.id, profileId: support.profileId, role: "support", status: "confirmed" },
    ]);
    await seedHostedEvent("Winter Gala", caller, "search-op", { venueName: "Studio_1" });
  });

  const titlesFor = async (search: string) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events?search=${encodeURIComponent(search)}`,
      headers: auth("search-op"),
    });
    expect(response.statusCode).toBe(200);
    return (response.json().items as { title: string }[]).map((row) => row.title).sort();
  };

  it("matches the event's own title", async () => {
    expect(await titlesFor("warmup")).toEqual(["Spring Warmup"]);
  });

  it("matches the venue, which is not on the event's title", async () => {
    expect(await titlesFor("funkhaus")).toEqual(["Album Release"]);
  });

  it("matches a PERFORMER on the bill — the thing Ran actually asked for", async () => {
    // "Marlo Vance" appears nowhere in that event's title or venue.
    expect(await titlesFor("vance")).toEqual(["Album Release"]);
  });

  it("returns ONE row per event, however many participants match", async () => {
    expect(await titlesFor("marlo")).toEqual(["Album Release"]);
  });

  it("is case-insensitive and matches inside a word", async () => {
    expect(await titlesFor("LANTERN")).toEqual(["Spring Warmup"]);
  });

  it("treats LIKE wildcards as literal characters", async () => {
    // "Studio_1" must be findable by its real name, and `_` must not match any
    // single character — otherwise "Studio 1" and "StudioX1" would match too.
    expect(await titlesFor("Studio_1")).toEqual(["Winter Gala"]);
    expect(await titlesFor("%")).toEqual([]);
  });

  it("an empty search is not a filter", async () => {
    expect((await titlesFor("")).length).toBe(3);
  });
});

describe("GET /events — the facts a row draws", () => {
  it("carries the venue name and the capacity all the way through serialization", async () => {
    const caller = await seedMemberWithSet(
      "row-venue-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Lantern Night", caller, "row-venue-op", {
      venueName: "The Lantern Hall",
      capacity: 400,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-venue-op"),
    });
    expect(response.statusCode).toBe(200);
    const [row] = response.json().items as { venueName: string; capacity: number }[];
    expect(row?.venueName).toBe("The Lantern Hall");
    expect(row?.capacity).toBe(400);
  });

  it("names the top of the bill — the headliner, not whoever was added first", async () => {
    const caller = await seedMemberWithSet(
      "row-bill-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const opener = await seedMemberWithSet(
      "row-bill-opener",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const headliner = await seedMemberWithSet(
      "row-bill-headliner",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Double Bill", caller, "row-bill-op");
    // Support goes on the bill FIRST, so ordering by insertion alone would name
    // the wrong act.
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: opener.profileId,
      role: "support",
      status: "confirmed",
    });
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: headliner.profileId,
      role: "performer",
      performerTag: "headliner",
      status: "confirmed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-bill-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (
      response.json().items as { id: string; headlinePerformerName: string | null }[]
    ).find((item) => item.id === event.id);
    expect(row?.headlinePerformerName).toBe("row-bill-headliner");
  });

  it("carries the headline act's UPLOADED picture, signed for this response", async () => {
    const caller = await seedMemberWithSet(
      "row-face-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headliner = await seedMemberWithSet(
      "row-face-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Face Value", caller, "row-face-op");

    // An avatar is normally an UPLOADED file (migration 0022); the legacy
    // `avatar_url` is left null on purpose, so a query that reads only that
    // column reports this act as faceless.
    const [file] = await harness.db
      .insert(schema.files)
      .values({
        ownerUserId: "row-face-perf",
        ownerProfileId: headliner.profileId,
        kind: "photo",
        path: `profiles/${headliner.profileId}/media/avatar.png`,
        contentType: "image/png",
        sizeBytes: 2048,
      })
      .returning();
    if (!file) throw new Error("file seed failed");
    await harness.db
      .update(schema.profiles)
      .set({ avatarFileId: file.id, avatarUrl: null })
      .where(eq(schema.profiles.id, headliner.profileId));

    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: headliner.profileId,
      role: "performer",
      performerTag: "headliner",
      status: "confirmed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-face-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (
      response.json().items as {
        id: string;
        headlinePerformerName: string | null;
        headlinePerformerAvatarUrl: string | null;
      }[]
    ).find((item) => item.id === event.id);
    expect(row?.headlinePerformerName).toBe("row-face-perf");
    // Minted from the FILE'S PATH — this suite's signer is the offline fake, so
    // the assertion is on the shape. What it proves is that the picture went
    // through the signer rather than out as a bucket path or as null.
    expect(row?.headlinePerformerAvatarUrl).toBe(
      `https://fake.storage.local/download/${encodeURIComponent(file.path)}`,
    );
  });

  it("leaves the face null when the headline act has no picture", async () => {
    const caller = await seedMemberWithSet(
      "row-noface-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headliner = await seedMemberWithSet(
      "row-noface-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("No Face", caller, "row-noface-op");
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: headliner.profileId,
      role: "performer",
      status: "confirmed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-noface-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (
      response.json().items as { id: string; headlinePerformerAvatarUrl: string | null }[]
    ).find((item) => item.id === event.id);
    expect(row?.headlinePerformerAvatarUrl).toBeNull();
  });

  it("leaves the bill empty when nobody is on it yet", async () => {
    const caller = await seedMemberWithSet(
      "row-nobill-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Nobody booked", caller, "row-nobill-op");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-nobill-op"),
    });
    expect(response.statusCode).toBe(200);
    const [row] = response.json().items as {
      headlinePerformerName: string | null;
      headlinePerformerAvatarUrl: string | null;
    }[];
    expect(row?.headlinePerformerName).toBeNull();
    expect(row?.headlinePerformerAvatarUrl).toBeNull();
  });

  it("reports the caller's settlement status, and null until someone runs one", async () => {
    const caller = await seedMemberWithSet(
      "row-settle-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const settled = await seedHostedEvent("Reconciled", caller, "row-settle-op");
    const untouched = await seedHostedEvent("Not reconciled", caller, "row-settle-op");

    const [hostParticipant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, settled.id));
    if (!hostParticipant) throw new Error("host participant seed failed");
    await harness.db.insert(schema.settlements).values({
      eventId: settled.id,
      participantId: hostParticipant.id,
      status: "finalized",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-settle-op"),
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json().items as { id: string; settlementStatus: string | null }[];
    expect(rows.find((row) => row.id === settled.id)?.settlementStatus).toBe("finalized");
    // No settlement rows at all means nobody has run it — the absence IS the
    // answer, and the screen says "Not started" rather than inventing a stage.
    expect(rows.find((row) => row.id === untouched.id)?.settlementStatus).toBeNull();
  });

  it("never answers with a settlement the caller is not a party to", async () => {
    const caller = await seedMemberWithSet(
      "row-scope-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "row-scope-performer",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Someone else's line", caller, "row-scope-op");
    const [performerParticipant] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        status: "confirmed",
      })
      .returning();
    if (!performerParticipant) throw new Error("performer participant seed failed");
    await harness.db.insert(schema.settlements).values({
      eventId: event.id,
      participantId: performerParticipant.id,
      status: "dispute",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-scope-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (response.json().items as { id: string; settlementStatus: string | null }[]).find(
      (item) => item.id === event.id,
    );
    // The performer's line is theirs (decisions #4). The host holds no settlement
    // row here, so the honest answer is nothing — not the other party's status.
    expect(row?.settlementStatus).toBeNull();
  });
});

/**
 * The guest list's limits, which used to be decoration.
 *
 * The product owner's finding: *"the guest list limits only present but don't
 * actually work. And 'note' field is missing."* Both settings persisted and
 * neither was read back — not by the add form, and not by the API, which took
 * two free numbers and never compared them to the list beside them. A limit only
 * the form respects is not a limit, so the rule is enforced HERE, on both routes
 * that write `extras` (`packages/shared/src/guest-list.ts` holds the rule; the
 * card calls the same function so the sentence appears under the cursor too).
 */
describe("PATCH/POST /events — the guest list's limits are enforced", () => {
  const guest = (name: string, tickets: number, note?: string) => ({
    id: `guest-${name}`,
    name,
    tickets,
    invitedBy: "Promoter",
    ...(note !== undefined ? { note } : {}),
  });

  it("accepts a list inside both limits", async () => {
    const host = await seedMemberWithSet(
      "gl-ok-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Comps fine", host, "gl-ok-op");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-ok-op"),
      payload: {
        extras: {
          guestList: { limitTotal: 40, limitPerGuest: 4, guests: [guest("Ada", 4)] },
        },
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("refuses a list over the TOTAL limit, naming the overage", async () => {
    const host = await seedMemberWithSet(
      "gl-total-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Comps over", host, "gl-total-op");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-total-op"),
      payload: {
        extras: {
          guestList: {
            limitTotal: 40,
            guests: [guest("Ada", 40), guest("Grace", 3)],
          },
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("3 over the 40 you allow in total");

    // Nothing was written: a refusal leaves the stored document alone.
    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.extras).toBeNull();
  });

  it("refuses a guest over the PER-GUEST limit, naming the guest", async () => {
    const host = await seedMemberWithSet(
      "gl-each-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Comps each", host, "gl-each-op");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-each-op"),
      payload: {
        extras: { guestList: { limitPerGuest: 2, guests: [guest("Ada", 5)] } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain(
      "Ada is down for 5 tickets — 3 over the 2 you allow per guest",
    );
  });

  /**
   * The already-over case, which is a product decision and not an oversight:
   * LOWERING a limit under a list that already breaks it is REFUSED. Accepting
   * it would store a document the rule says cannot exist, and from then on "the
   * limit" is advisory again — the exact defect being fixed.
   */
  it("refuses a limit LOWERED under a list that already breaks it", async () => {
    const host = await seedMemberWithSet(
      "gl-lower-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Comps lowered", host, "gl-lower-op");
    const guests = [guest("Ada", 20), guest("Grace", 23)];

    const seeded = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-lower-op"),
      payload: { extras: { guestList: { limitTotal: 50, guests } } },
    });
    expect(seeded.statusCode).toBe(200);

    const lowered = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-lower-op"),
      payload: { extras: { guestList: { limitTotal: 40, guests } } },
    });
    expect(lowered.statusCode).toBe(400);
    expect(lowered.json().error.message).toContain("3 over the 40 you allow in total");
    expect(lowered.json().error.message).toContain("Take 3 tickets off the list");
  });

  it("refuses the same thing on CREATE — one call site is no call sites", async () => {
    const host = await seedMemberWithSet(
      "gl-create-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("gl-create-op"), "x-profile-id": host.profileId },
      payload: {
        title: "Born over the limit",
        baseCurrency: "SEK",
        extras: { guestList: { limitTotal: 2, guests: [guest("Ada", 5)] } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("3 over the 2 you allow in total");
  });

  it("round-trips a guest's note — the field that was missing", async () => {
    const host = await seedMemberWithSet(
      "gl-note-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Comps noted", host, "gl-note-op");

    const written = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-note-op"),
      payload: {
        extras: {
          guestList: { guests: [guest("Ada", 2, "collects at the box office")] },
        },
      },
    });
    expect(written.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-note-op"),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().extras.guestList.guests[0]).toMatchObject({
      name: "Ada",
      tickets: 2,
      note: "collects at the box office",
    });
  });
});

/**
 * The one door the limit rule must NOT stand in: an operator editing something
 * else entirely. `extras` is written whole, so every PATCH carries the guest list
 * whether or not it is what changed.
 */
describe("PATCH /events/:id — a guest list saved before the rule does not brick the card", () => {
  it("lets an unrelated extras edit through, then refuses the moment the list is touched", async () => {
    const { db } = harness;
    const host = await seedMemberWithSet(
      "gl-legacy-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const guestList = {
      limitTotal: 2,
      guests: [{ id: "g1", name: "Ada", tickets: 9, invitedBy: "Promoter" }],
    };
    // Written straight to the column, exactly as a row from before the rule.
    const event = await seedHostedEvent("Legacy comps", host, "gl-legacy-op", {
      extras: { guestList },
    });

    const unrelated = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-legacy-op"),
      payload: { extras: { guestList, cateringNotes: "Two vegan mains" } },
    });
    expect(unrelated.statusCode).toBe(200);
    const [after] = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect((after?.extras as { cateringNotes?: string })?.cateringNotes).toBe("Two vegan mains");

    const touched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("gl-legacy-op"),
      payload: {
        extras: {
          guestList: {
            ...guestList,
            guests: [
              ...guestList.guests,
              { id: "g2", name: "Grace", tickets: 1, invitedBy: "Promoter" },
            ],
          },
        },
      },
    });
    expect(touched.statusCode).toBe(400);
    expect(touched.json().error.message).toContain("8 over the 2 you allow in total");
  });
});

/**
 * `GET /events/date-conflicts` — the warning that did not exist.
 *
 * ClickUp 86cbceux0. The room-scoped rule (`@showme/shared` `occupiedDates`) has
 * been written and tested since the calendar was built; what was missing was
 * anything asking it at the moment somebody was about to create a clash. These
 * assert the ANSWERS, especially the one that makes the feature worth having:
 * a venue with a free basement is not busy because its main hall is sold.
 */
describe("GET /events/date-conflicts — warning before the booking", () => {
  const NIGHT = "2026-11-14";

  /** An operator with a venue profile and two rooms in it. */
  async function seedVenueWithRooms(prefix: string) {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const rooms = await db
      .insert(schema.stages)
      .values([
        { venueProfileId: operator.profileId, name: "Main Hall", capacity: 400 },
        { venueProfileId: operator.profileId, name: "Basement", capacity: 90 },
      ])
      .returning();
    const [main, basement] = rooms;
    if (!main || !basement) throw new Error("room seed failed");
    return { operator, main, basement };
  }

  const ask = (uid: string, query: Record<string, string>) =>
    app.inject({
      method: "GET",
      url: `/api/v1/events/date-conflicts?${new URLSearchParams(query).toString()}`,
      headers: auth(uid),
    });

  it("reports a free night as free", async () => {
    const { operator } = await seedVenueWithRooms("dc-free");
    const response = await ask("dc-free-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ roomIsBusy: false, events: [], unavailability: [] });
  });

  it("names the show already on that night", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-taken");
    await seedHostedEvent("Neon Tide", operator, "dc-taken-op", {
      eventDate: NIGHT,
      // A BOOKED night — these assert the room maths, not the status rule,
      // and a draft no longer takes a room (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
      stageId: main.id,
    });

    const response = await ask("dc-taken-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json().roomIsBusy).toBe(true);
    expect(response.json().events).toHaveLength(1);
    expect(response.json().events[0]).toMatchObject({
      title: "Neon Tide",
      stageName: "Main Hall",
    });
  });

  /**
   * THE WHOLE POINT OF DOING THIS PER ROOM. Ran: *"a promoter could book as many
   * shows as they like on one date, as long as the space is not the same."* A
   * venue-wide check would call this busy and turn away a booking the basement
   * could take.
   */
  it("leaves the basement free when only the main hall is booked", async () => {
    const { operator, main, basement } = await seedVenueWithRooms("dc-rooms");
    await seedHostedEvent("Neon Tide", operator, "dc-rooms-op", {
      eventDate: NIGHT,
      // A BOOKED night — these assert the room maths, not the status rule,
      // and a draft no longer takes a room (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
      stageId: main.id,
    });

    const busyRoom = await ask("dc-rooms-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(busyRoom.json().roomIsBusy).toBe(true);

    const freeRoom = await ask("dc-rooms-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: basement.id,
    });
    expect(freeRoom.json().roomIsBusy).toBe(false);
    // It still LISTS the other show — "the building is busy, this room is not"
    // is more use than silence.
    expect(freeRoom.json().events).toHaveLength(1);
  });

  it("calls the venue entire busy only when every room is taken", async () => {
    const { operator, main, basement } = await seedVenueWithRooms("dc-full");
    await seedHostedEvent("Main show", operator, "dc-full-op", {
      eventDate: NIGHT,
      // Booked, not drafted — this asserts the room maths (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
      stageId: main.id,
    });

    const partly = await ask("dc-full-op", { venueProfileId: operator.profileId, date: NIGHT });
    expect(partly.json().roomIsBusy).toBe(false);

    await seedHostedEvent("Cellar show", operator, "dc-full-op", {
      eventDate: NIGHT,
      // Booked, not drafted — this asserts the room maths (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
      stageId: basement.id,
    });
    const full = await ask("dc-full-op", { venueProfileId: operator.profileId, date: NIGHT });
    expect(full.json().roomIsBusy).toBe(true);
  });

  /**
   * A show with no room recorded occupies EVERY room, because nobody can say
   * which one it is in. Erring the other way would let the venue sell a night it
   * has already booked — the worst thing this feature can do.
   */
  it("treats a show with no room set as occupying every room", async () => {
    const { operator, basement } = await seedVenueWithRooms("dc-unassigned");
    await seedHostedEvent("Room TBC", operator, "dc-unassigned-op", {
      eventDate: NIGHT,
      // A BOOKED night — these assert the room maths, not the status rule,
      // and a draft no longer takes a room (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
    });

    const response = await ask("dc-unassigned-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: basement.id,
    });
    expect(response.json().roomIsBusy).toBe(true);
  });

  it("ignores a cancelled show — it is not holding the room", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-cancelled");
    await seedHostedEvent("Called off", operator, "dc-cancelled-op", {
      eventDate: NIGHT,
      venueProfileId: operator.profileId,
      stageId: main.id,
      status: "cancelled",
    });

    const response = await ask("dc-cancelled-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json()).toMatchObject({ roomIsBusy: false, events: [] });
  });

  /**
   * A DRAFT DOES NOT HOLD THE ROOM — and this test used to assert the opposite.
   *
   * It was written on the reasoning that a draft is somebody's intention and
   * noticing early is the point. Ran overturned it (123qy9rp9rx): *"when is the
   * date taken? When it is moved from suggested to pending. I.e. the performer
   * accepts the date."* Counting drafts is what made the warning fire on nights
   * nobody had been asked about.
   *
   * The show is still LISTED, so the screen can say a draft is there without
   * calling the room busy — the distinction the old rule could not make.
   */
  it("does not let a draft hold the room, but still mentions it", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-draft");
    await seedHostedEvent("Pencilled in", operator, "dc-draft-op", {
      eventDate: NIGHT,
      venueProfileId: operator.profileId,
      stageId: main.id,
      status: "draft",
    });

    const response = await ask("dc-draft-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json().roomIsBusy).toBe(false);
    expect(response.json().events).toHaveLength(1);
    expect(response.json().events[0]).toMatchObject({ title: "Pencilled in", status: "draft" });
  });

  /** An unanswered OFFER is not a booking either — it is a question. */
  it("does not let a suggested night hold the room", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-sugg");
    await seedHostedEvent("Offered, unanswered", operator, "dc-sugg-op", {
      eventDate: NIGHT,
      venueProfileId: operator.profileId,
      stageId: main.id,
      status: "suggested",
    });

    const response = await ask("dc-sugg-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json().roomIsBusy).toBe(false);
  });

  /**
   * THE LINE ITSELF. `pending` means the act accepted — this is the first status
   * that takes the night, and the assertion that fails if anybody narrows the
   * rule back to signed deals only.
   */
  it("holds the room from the moment the act accepts, before anything is signed", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-pending");
    await seedHostedEvent("They said yes", operator, "dc-pending-op", {
      eventDate: NIGHT,
      venueProfileId: operator.profileId,
      stageId: main.id,
      status: "pending",
    });

    const response = await ask("dc-pending-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json().roomIsBusy).toBe(true);
  });

  /**
   * ── A ROOM CAN BE SHUT WITHOUT THE BUILDING (86cbceux0, third box) ────────
   *
   * Ran: *"the system had the ability to mark multi unavailabilities per date,
   * per venue and per room/space."* Before this, blocking a date shut the whole
   * profile, so a refit in one room took every other room off sale with it.
   */
  it("blocks only the room it names, and leaves the others sellable", async () => {
    const { db } = harness;
    const { operator, main, basement } = await seedVenueWithRooms("dc-roomblock");
    await db.insert(schema.profileUnavailability).values({
      profileId: operator.profileId,
      startDate: NIGHT,
      endDate: NIGHT,
      reason: "Refit",
      stageId: main.id,
    });

    const shut = await ask("dc-roomblock-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(shut.json().unavailability).toHaveLength(1);
    expect(shut.json().unavailability[0]).toMatchObject({ reason: "Refit" });

    // The whole point: the other room is untouched.
    const open = await ask("dc-roomblock-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: basement.id,
    });
    expect(open.json().unavailability).toEqual([]);
  });

  it("does not call the venue shut because one of its rooms is", async () => {
    const { db } = harness;
    const { operator, main } = await seedVenueWithRooms("dc-partial");
    await db.insert(schema.profileUnavailability).values({
      profileId: operator.profileId,
      startDate: NIGHT,
      endDate: NIGHT,
      stageId: main.id,
    });

    // Venue-wide question, one room shut, one free — the building can still
    // take a booking, and saying otherwise turns away a show the basement wants.
    const venue = await ask("dc-partial-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(venue.json().unavailability).toEqual([]);
  });

  it("calls the venue shut once every room is", async () => {
    const { db } = harness;
    const { operator, main, basement } = await seedVenueWithRooms("dc-allrooms");
    await db.insert(schema.profileUnavailability).values([
      { profileId: operator.profileId, startDate: NIGHT, endDate: NIGHT, stageId: main.id },
      { profileId: operator.profileId, startDate: NIGHT, endDate: NIGHT, stageId: basement.id },
    ]);

    const venue = await ask("dc-allrooms-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(venue.json().unavailability).toHaveLength(2);
  });

  /** A block with no room is the whole place, which is what every block written
   *  before this column existed meant. */
  it("still lets a whole-venue block shut every room", async () => {
    const { db } = harness;
    const { operator, main, basement } = await seedVenueWithRooms("dc-whole");
    await db.insert(schema.profileUnavailability).values({
      profileId: operator.profileId,
      startDate: NIGHT,
      endDate: NIGHT,
      reason: "Closed",
      stageId: null,
    });

    for (const [label, room] of [
      ["main", main],
      ["basement", basement],
    ] as const) {
      const response = await ask("dc-whole-op", {
        venueProfileId: operator.profileId,
        date: NIGHT,
        stageId: room.id,
      });
      expect(response.json().unavailability, label).toHaveLength(1);
    }
    const venue = await ask("dc-whole-op", { venueProfileId: operator.profileId, date: NIGHT });
    expect(venue.json().unavailability).toHaveLength(1);
  });

  /** Editing an event must not warn that it clashes with itself. */
  it("excludes the event being edited", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-self");
    const event = await seedHostedEvent("The one being edited", operator, "dc-self-op", {
      eventDate: NIGHT,
      // A BOOKED night — these assert the room maths, not the status rule,
      // and a draft no longer takes a room (123qy9rp9rx).
      status: "pending",
      venueProfileId: operator.profileId,
      stageId: main.id,
    });

    const response = await ask("dc-self-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
      excludeEventId: event.id,
    });
    expect(response.json()).toMatchObject({ roomIsBusy: false, events: [] });
  });

  it("reports a date the operator marked unavailable, with the reason", async () => {
    const { operator } = await seedVenueWithRooms("dc-blocked");
    await harness.db.insert(schema.profileUnavailability).values({
      profileId: operator.profileId,
      startDate: "2026-11-10",
      endDate: "2026-11-20",
      reason: "Refit",
    });

    const response = await ask("dc-blocked-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(response.json().unavailability).toEqual([
      { startDate: "2026-11-10", endDate: "2026-11-20", reason: "Refit" },
    ]);
  });

  it("does not report a block that ends before the night asked about", async () => {
    const { operator } = await seedVenueWithRooms("dc-past-block");
    await harness.db.insert(schema.profileUnavailability).values({
      profileId: operator.profileId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      reason: "Refit",
    });

    const response = await ask("dc-past-block-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(response.json().unavailability).toEqual([]);
  });

  it("ignores a show at the same venue on a different night", async () => {
    const { operator, main } = await seedVenueWithRooms("dc-other-night");
    await seedHostedEvent("The night before", operator, "dc-other-night-op", {
      eventDate: "2026-11-13",
      venueProfileId: operator.profileId,
      stageId: main.id,
    });

    const response = await ask("dc-other-night-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
      stageId: main.id,
    });
    expect(response.json()).toMatchObject({ roomIsBusy: false, events: [] });
  });

  /**
   * Another operator's calendar is not ours to read. "The 14th is busy" for any
   * profile id you can guess would leak their whole booking schedule.
   */
  it("refuses somebody with no membership of the venue", async () => {
    const { operator } = await seedVenueWithRooms("dc-stranger");
    await seedMemberWithSet("dc-stranger-out", "operator", PRESET_PERMISSION_SETS.operator_full);

    const response = await ask("dc-stranger-out", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  /**
   * The route sits at `/events/date-conflicts` and must not be swallowed by
   * `/events/:id`. Fastify prefers a static segment over a parametric one, and
   * this is the test that says so out loud.
   */
  it("is not captured by the /events/:id route", async () => {
    const { operator } = await seedVenueWithRooms("dc-routing");
    const response = await ask("dc-routing-op", {
      venueProfileId: operator.profileId,
      date: NIGHT,
    });
    // A 200 with this body shape can only have come from the conflicts handler.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("roomIsBusy");
  });
});
