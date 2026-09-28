import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { holdRoutes } from "./routes/holds";
import { buildTestApp } from "./testing";

/**
 * A HOLD THAT JOINS A QUEUE LATE TAKES A NUMBER (QA sweep run 5, QA5-4).
 *
 * `events.hold_rank` is nullable and every reader answers 1 for NULL — right for the
 * only pencil on a night, wrong the moment the hold shares its queue. The app had a
 * path straight into the wrong case: a hold placed against a typed venue NAME is in
 * no queue at all (the pool is keyed on the venue PROFILE), so its placement writes
 * no rank; attaching the venue afterwards drops it into a queue that already has a
 * first, and the pool comes back with two 1sts that no screen can separate, because
 * `canPromoteToFirst` is `(holdRank ?? 1) !== 1`.
 *
 * Both routes are registered because the defect spans them: the PATCH is where the
 * hold moves queue, and `GET /events/:id/hold` is the surface that showed the tie.
 */
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
    eventRoutes,
    holdRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

async function seedOperator(id: string) {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  await db.insert(schema.permissionSets).values({
    profileId: profile.id,
    name: "operator",
    capabilities: [...PRESET_PERMISSION_SETS.operator_full],
  });
  return { userId: id, profileId: profile.id };
}

const headers = (uid: string, profileId: string) => ({
  authorization: `Bearer ${uid}`,
  "x-profile-id": profileId,
});

/** A hold as the wizard leaves it: on hold, and rank NULL when nothing competed. */
async function placeHold(
  operator: { userId: string; profileId: string },
  title: string,
  body: Record<string, unknown>,
) {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    headers: headers(operator.userId, operator.profileId),
    payload: { title, baseCurrency: "SEK", ...body },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  const held = await app.inject({
    method: "PATCH",
    url: `/api/v1/events/${id}`,
    headers: headers(operator.userId, operator.profileId),
    payload: { status: "on_hold" },
  });
  expect(held.statusCode).toBe(200);
  return id;
}

const rankOf = async (id: string) =>
  (await harness.db.select().from(schema.events).where(eq(schema.events.id, id)))[0]?.holdRank ??
  null;

describe("a hold joining a queue takes a number", () => {
  it("ranks a hold behind the queue when a typed venue is replaced by the real one", async () => {
    const operator = await seedOperator("hq-op");

    // The night's first pencil, properly pinned to the room. Alone, so NULL — which
    // every reader answers as 1st, and that is the design.
    const first = await placeHold(operator, "First pencil", {
      eventDate: "2026-12-04",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(first)).toBeNull();

    // The second, placed against a venue NAME. It is in no queue, so nothing ranks it.
    const second = await placeHold(operator, "Typed venue pencil", {
      eventDate: "2026-12-04",
      venueName: "The room somebody typed",
    });
    expect(await rankOf(second)).toBeNull();

    const attached = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${second}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { venueProfileId: operator.profileId },
    });
    expect(attached.statusCode).toBe(200);

    // THE FIX: it joined the queue, so it took the back of it rather than tying for
    // first. The pencil that was already there is untouched.
    expect(await rankOf(second)).toBe(2);
    expect(await rankOf(first)).toBeNull();

    const pool = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${second}/hold`,
        headers: headers(operator.userId, operator.profileId),
      })
    ).json();
    expect(pool.pool.map((entry: { holdRank: number }) => entry.holdRank)).toEqual([1, 2]);
    // And the screen can now break it: "Promote to 1st" is enabled on anything whose
    // rank is not already 1.
    expect(pool.holdRank).toBe(2);
  });

  it("answers with the rank it just wrote (QA6-5)", async () => {
    // The update is its own statement, so the route's `after` object held the rank the
    // row had BEFORE it — the PATCH answered `holdRank: null` on a hold Postgres had
    // just made 2nd, and a client that renders the mutation response drew "1st hold".
    const operator = await seedOperator("hq-echo");
    await placeHold(operator, "The first pencil", {
      eventDate: "2027-09-09",
      venueProfileId: operator.profileId,
    });
    const second = await placeHold(operator, "Typed venue pencil", {
      eventDate: "2027-09-09",
      venueName: "The room somebody typed",
    });
    const attached = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${second}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { venueProfileId: operator.profileId },
    });
    expect(attached.statusCode).toBe(200);
    expect(attached.json().holdRank).toBe(2);
    expect(await rankOf(second)).toBe(2);
  });

  it("re-ranks a hold that MOVES to another queue instead of carrying its number (QA6-6)", async () => {
    // A rank is a position in one queue and means nothing in another. A hold sitting
    // 2nd on one night, moved to a night that already had a 2nd, made two 2nds.
    const operator = await seedOperator("hq-move");
    await placeHold(operator, "Origin first", {
      eventDate: "2027-10-01",
      venueProfileId: operator.profileId,
    });
    const traveller = await placeHold(operator, "The traveller", {
      eventDate: "2027-10-01",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(traveller)).toBe(2);

    // The destination already holds a queue of two.
    await placeHold(operator, "Destination first", {
      eventDate: "2027-10-08",
      venueProfileId: operator.profileId,
    });
    const destinationSecond = await placeHold(operator, "Destination second", {
      eventDate: "2027-10-08",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(destinationSecond)).toBe(2);

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${traveller}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { eventDate: "2027-10-08" },
    });
    expect(moved.statusCode).toBe(200);
    expect(await rankOf(traveller)).toBe(3);
    expect(moved.json().holdRank).toBe(3);
    // And nobody in the destination queue was disturbed.
    expect(await rankOf(destinationSecond)).toBe(2);
  });

  it("gives a moved hold its NULL back when it lands in an empty queue", async () => {
    // Otherwise it reads as "2nd" on a night where it is the only pencil — a number
    // describing a queue it has left.
    const operator = await seedOperator("hq-alone");
    await placeHold(operator, "Crowded first", {
      eventDate: "2027-11-05",
      venueProfileId: operator.profileId,
    });
    const traveller = await placeHold(operator, "Leaving the crowd", {
      eventDate: "2027-11-05",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(traveller)).toBe(2);

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${traveller}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { eventDate: "2027-11-12" },
    });
    expect(moved.statusCode).toBe(200);
    expect(await rankOf(traveller)).toBeNull();
    expect(moved.json().holdRank).toBeNull();
  });

  it("leaves a lone hold unranked — NULL is the first hold", async () => {
    const operator = await seedOperator("hq-lone");
    // A queue is per DATE. This pencil on the same stage a week earlier is a
    // different queue, and counting it would rank the hold below as a 2nd.
    await placeHold(operator, "Another night entirely", {
      eventDate: "2027-01-26",
      venueProfileId: operator.profileId,
    });
    const lone = await placeHold(operator, "The only pencil", {
      eventDate: "2027-02-02",
      venueProfileId: operator.profileId,
    });
    // Nothing to queue behind, so nothing is written and no rank line is filed.
    expect(await rankOf(lone)).toBeNull();

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${lone}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { eventDate: "2027-02-09" },
    });
    expect(moved.statusCode).toBe(200);
    expect(await rankOf(lone)).toBeNull();
  });

  it("does not re-derive a rank somebody already decided", async () => {
    const operator = await seedOperator("hq-keep");
    const first = await placeHold(operator, "Keeper first", {
      eventDate: "2027-03-03",
      venueProfileId: operator.profileId,
    });
    const second = await placeHold(operator, "Keeper second", {
      eventDate: "2027-03-03",
      venueProfileId: operator.profileId,
    });
    // The second hold went in behind the first, as a hold joining a queue does.
    expect(await rankOf(second)).toBe(2);

    // Promoted by hand, the way the panel does it.
    const promoted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${second}/hold/rank`,
      headers: headers(operator.userId, operator.profileId),
      payload: { holdRank: 1 },
    });
    expect(promoted.statusCode).toBe(200);
    expect(await rankOf(second)).toBe(1);
    expect(await rankOf(first)).toBe(2);

    // An unrelated edit that touches a queue field must not undo that decision.
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${second}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { venueProfileId: operator.profileId, stageId: null, status: "on_hold" },
    });
    expect(edited.statusCode).toBe(200);
    expect(await rankOf(second)).toBe(1);
    expect(await rankOf(first)).toBe(2);
  });

  it("gives no rank to an event that is not a hold", async () => {
    // A confirmed show on a contested night is not in the queue — it HAS the night.
    // Without the status guard an ordinary edit to it would hand it a hold rank,
    // which the panel would then draw as a queue position on a booked show.
    const operator = await seedOperator("hq-confirmed");
    await placeHold(operator, "The pencil", {
      eventDate: "2027-05-05",
      venueProfileId: operator.profileId,
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: {
        title: "The booking",
        baseCurrency: "SEK",
        eventDate: "2027-05-05",
        venueProfileId: operator.profileId,
      },
    });
    const booking = created.json().id as string;
    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${booking}`,
      headers: headers(operator.userId, operator.profileId),
      payload: { status: "confirmed" },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(await rankOf(booking)).toBeNull();

    // And it is not IN the queue either: the next pencil on that night is the 2nd,
    // behind the one hold — not the 3rd behind a confirmed show that holds the date
    // outright.
    const late = await placeHold(operator, "A late pencil", {
      eventDate: "2027-05-05",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(late)).toBe(2);
  });

  it("counts only LIVE pencils — a cancelled hold keeps its rank and must not queue", async () => {
    /*
     * The confirm cascade cancels the competing holds and leaves `hold_rank` where
     * it was (`routes/holds.ts`: *"only ever writes `cancelled` (and, on decline,
     * `hold_rank`)"*). So a dead 4th sits on the date forever, and a queue key that
     * did not filter on status would send the next pencil to 5th place in a queue
     * of one.
     */
    const operator = await seedOperator("hq-dead");
    const live = await placeHold(operator, "The live pencil", {
      eventDate: "2027-06-06",
      venueProfileId: operator.profileId,
    });
    await harness.db.insert(schema.events).values({
      hostProfileId: operator.profileId,
      title: "A hold that lost this date",
      baseCurrency: "SEK",
      status: "cancelled",
      eventDate: "2027-06-06",
      venueProfileId: operator.profileId,
      holdRank: 4,
      createdBy: operator.userId,
    });

    const joining = await placeHold(operator, "The next pencil", {
      eventDate: "2027-06-06",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(live)).toBeNull();
    expect(await rankOf(joining)).toBe(2);
  });

  it("counts only this room, and only this venue", async () => {
    // A queue is (date, venue, room). A pencil in the Main Room and a pencil on the
    // whole venue are not competing for the same thing, and another venue's night is
    // nobody else's queue at all — counting either would push this hold down a queue
    // it is not in.
    const operator = await seedOperator("hq-room");
    const elsewhere = await seedOperator("hq-elsewhere");
    const [stage] = await harness.db
      .insert(schema.stages)
      .values({ venueProfileId: operator.profileId, name: "The Back Room", capacity: 90 })
      .returning();
    if (!stage) throw new Error("stage seed failed");

    await placeHold(operator, "A pencil in the back room", {
      eventDate: "2027-07-07",
      venueProfileId: operator.profileId,
      stageId: stage.id,
    });
    await placeHold(elsewhere, "A pencil at another venue", {
      eventDate: "2027-07-07",
      venueProfileId: elsewhere.profileId,
    });

    const wholeVenue = await placeHold(operator, "A pencil on the whole venue", {
      eventDate: "2027-07-07",
      venueProfileId: operator.profileId,
    });
    // Alone in its own queue, so still NULL.
    expect(await rankOf(wholeVenue)).toBeNull();
  });

  it("does not queue behind a stranger's typed-in venue name", async () => {
    // The rule `routes/holds.ts` already enforces for ranking: a name typed into a
    // box is not a shared room, so two operators who each typed one are in two
    // queues, not one. Counting a stranger's would tell this operator they are 2nd
    // for a night nobody else can claim.
    const operator = await seedOperator("hq-typed-mine");
    const stranger = await seedOperator("hq-typed-theirs");
    await placeHold(stranger, "Their unpinned night", {
      eventDate: "2027-08-08",
      venueName: "A room somebody else typed",
    });
    const mine = await placeHold(operator, "My unpinned night", {
      eventDate: "2027-08-08",
      venueName: "A room I typed",
    });
    expect(await rankOf(mine)).toBeNull();

    // But my OWN second unpinned pencil on that night is a real queue of two.
    const alsoMine = await placeHold(operator, "My second unpinned night", {
      eventDate: "2027-08-08",
      venueName: "A room I typed",
    });
    expect(await rankOf(alsoMine)).toBe(2);
  });

  it("queues a hold placed straight onto a contested night", async () => {
    // The commonest path, and the one the wizard already handled from the client:
    // proving the server does it too means a hold placed by any caller — the API,
    // the assistant, a script — cannot land as a second 1st.
    const operator = await seedOperator("hq-direct");
    const first = await placeHold(operator, "Direct first", {
      eventDate: "2027-04-04",
      venueProfileId: operator.profileId,
    });
    const second = await placeHold(operator, "Direct second", {
      eventDate: "2027-04-04",
      venueProfileId: operator.profileId,
    });
    expect(await rankOf(first)).toBeNull();
    expect(await rankOf(second)).toBe(2);
  });
});
