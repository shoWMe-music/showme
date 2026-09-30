import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { eventListRoutes } from "./routes/events-list";
import { participantRoutes } from "./routes/participants";
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
    participantRoutes,
    // `GET /events` resolves reachability with its OWN sql, so the leak test
    // below needs the real list route rather than a stand-in.
    eventListRoutes,
    // `PATCH /events/:id` is where a date change becomes a question (86cbcftg3).
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
  kind: "operator" | "performer" | "team_and_crew" | "agent",
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

/** An operator with an event + host participant, plus a seeded performer profile. */
async function seedEventWithHost(prefix: string) {
  const { db } = harness;
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const performer = await seedMemberWithSet(
    `${prefix}-perf`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Roster Night",
      baseCurrency: "SEK",
      createdBy: `${prefix}-op`,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  const [hostParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!hostParticipant) throw new Error("host participant seed failed");

  return { operator, performer, event, hostParticipant };
}

describe("participants — authorize + serialize + audit", () => {
  it("lets an operator list with full fields and add a performer (with audit)", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("list-op");

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("list-op-op"),
      payload: {
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        performerTag: "headliner",
      },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().profileId).toBe(performer.profileId);
    expect(added.json().performerTag).toBe("headliner");
    // Operator tier: sees the permission set id on the row it just created.
    expect(added.json().permissionSetId).toBe(performer.permissionSetId);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, added.json().id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("participant.add");
    expect(audit[0]?.actorUserId).toBe("list-op-op");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("list-op-op"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(2); // host + performer
    // Operator sees the full field set on every row.
    for (const row of rows) {
      expect(row).toHaveProperty("permissionSetId");
    }
    expect(rows.map((row: { role: string }) => row.role).sort()).toEqual(["host", "performer"]);
    expect(operator.profileId).toBeDefined();
  });

  it("writes a notification to the added profile's member on participant-add", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("notify");

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("notify-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(added.statusCode).toBe(201);

    // The performer's active member ("notify-perf") gets a feed row; the acting
    // operator ("notify-op") does not (you never notify yourself).
    const forPerformer = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "notify-perf"));
    expect(forPerformer).toHaveLength(1);
    expect(forPerformer[0]?.type).toBe("event.participant_added");
    expect(forPerformer[0]?.eventId).toBe(event.id);
    expect(forPerformer[0]?.title).toBe('Added to "Roster Night"');
    /*
     * AND THE LINK GOES SOMEWHERE THEY CAN GO (QA sweep run 9, QA9-3).
     *
     * A row this route creates is `invited`, and `authorize` excludes `invited` from a standing
     * participation — correctly, since nothing is granted until the invitation is answered. So
     * `/events/:id` answered 404 to the person the bell had just told they were added, and the
     * sweep's screenshot reads "Couldn't load this event — Event not found". `/requests` is where
     * `EventInvitationsCard` renders `GET /me/event-invitations` with Accept and Decline on it.
     */
    expect(forPerformer[0]?.link).toBe("/requests");
    // The 404 it used to point at, so this test carries its own reason.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/events/${event.id}`,
          headers: auth("notify-perf"),
        })
      ).statusCode,
    ).toBe(404);

    const forOperator = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "notify-op"));
    expect(forOperator).toHaveLength(0);
  });

  /**
   * …AND A CO-PROMOTER IS SENT TO THE EVENT, because they can open it (QA9-3).
   *
   * The other half of the same rule, and the half a surviving mutation found missing: making the
   * link *always* `/requests` broke no test. A `co_host` added through this route lands
   * **`accepted`**, not `invited` — this file's own comment gives the reason, *"adding a
   * co-promoter here RECORDS an arrangement rather than asking a question"* — so they hold a
   * standing participation, the event opens for them, and sending them to an invitations inbox that
   * has nothing in it would be the mirror image of the bug.
   */
  it("sends an added co-promoter to the event itself, which opens for them", async () => {
    const { db } = harness;
    const { operator, event } = await seedEventWithHost("cohost-link");
    const coHost = await seedMemberWithSet(
      "cohost-link-co",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("cohost-link-op"),
      payload: { profileId: coHost.profileId, role: "co_host" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().status).toBe("accepted");
    expect(operator.profileId).not.toBe(coHost.profileId);

    const bell = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "cohost-link-co"));
    expect(bell).toHaveLength(1);
    expect(bell[0]?.link).toBe(`/events/${event.id}`);

    // …and it is not a dead link: the event answers for them.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/events/${event.id}`,
          headers: auth("cohost-link-co"),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("shows a performer only the public fields of other participants", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("pub");

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
      details: { payNote: "secret" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("pub-perf"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(2);
    // Public tier: every row carries only the public face — no set id / details.
    for (const row of rows) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("profileId");
      expect(row).toHaveProperty("role");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("performerTag");
      expect(row.permissionSetId).toBeUndefined();
      expect(row.details).toBeUndefined();
    }
  });

  /**
   * A crew member is asked to be in the building at a stated time. Until this
   * test, `serializeParticipant` returned `details` to the managing operators and
   * to nobody else — so the one person whose whole engagement is "turn up at
   * 16:15 and mix front of house" was the one party who could not read 16:15.
   *
   * The split is between what is ADDRESSED TO the crew member and what is the
   * operator's own record of them. `docs/story.md` — team_and_crew is an
   * "arm's-length service provider paid a fixed fee" who "see the schedule and
   * their own deal, never the budget": the call time and the task are the terms
   * of the labour, the operator's private note and pay note are the operator's
   * commentary and bookkeeping, and the roster provenance keys name OTHER rows.
   */
  it("shows a crew member their OWN call time but not the operator's notes", async () => {
    const { db } = harness;
    const { operator, event, hostParticipant } = await seedEventWithHost("selfcrew");
    const crew = await seedMemberWithSet(
      "selfcrew-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );

    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: "selfcrew-op", name: "Sound crew" })
      .returning();
    if (!group) throw new Error("group seed failed");

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
      details: {
        callTime: "16:15",
        task: "Front-of-house sound",
        roleLabel: "Stage Manager",
        privateNote: "Chronically late — chase him at four.",
        payNote: "Fee invoiced separately, do not mention on the night",
        sponsorParticipantId: hostParticipant.id,
        sourceGroupId: group.id,
      },
    });

    const asCrew = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("selfcrew-crew"),
    });
    expect(asCrew.statusCode).toBe(200);
    const own = asCrew
      .json()
      .find((row: { profileId: string }) => row.profileId === crew.profileId);
    // The point of the whole fix.
    expect(own?.details?.callTime).toBe("16:15");
    expect(own?.details?.task).toBe("Front-of-house sound");
    expect(own?.details?.roleLabel).toBe("Stage Manager");
    // …and none of the operator's side of the blob comes with it.
    expect(own?.details?.privateNote).toBeUndefined();
    expect(own?.details?.payNote).toBeUndefined();
    expect(own?.details?.sponsorParticipantId).toBeUndefined();
    expect(own?.details?.sourceGroupId).toBeUndefined();
    // Self-visibility is not a promotion: the permission set stays operator-only.
    expect(own?.permissionSetId).toBeUndefined();

    // A third party's row is exactly as it was — the public face and nothing else.
    const host = asCrew
      .json()
      .find((row: { profileId: string }) => row.profileId === operator.profileId);
    expect(host?.details).toBeUndefined();

    // The operator still sees the whole blob, self-branch or no self-branch.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("selfcrew-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    const seenByOperator = asOperator
      .json()
      .find((row: { profileId: string }) => row.profileId === crew.profileId);
    expect(seenByOperator?.details?.callTime).toBe("16:15");
    expect(seenByOperator?.details?.privateNote).toBe("Chronically late — chase him at four.");
    expect(seenByOperator?.details?.payNote).toBe(
      "Fee invoiced separately, do not mention on the night",
    );
    expect(seenByOperator?.details?.sponsorParticipantId).toBe(hostParticipant.id);
  });

  it("409s a duplicate (same event + profile)", async () => {
    const { performer, event } = await seedEventWithHost("dup");
    const payload = { profileId: performer.profileId, role: "performer" as const };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("dup-op"),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("dup-op"),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it("403s changing the host's role", async () => {
    const { event, hostParticipant } = await seedEventWithHost("host");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${hostParticipant.id}`,
      headers: auth("host-op"),
      payload: { role: "performer" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403s a non-operator POST", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("perm");

    // Make the performer an actual participant so they can VIEW (not 404).
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("perm-perf"),
      payload: { profileId: performer.profileId, role: "crew" },
    });
    expect(response.statusCode).toBe(403);
  });
});

/**
 * The roster's faces (migration 0022).
 *
 * `avatar_file_id` is the NORMAL way to have a picture — you upload one — and
 * `avatar_url` is only the legacy external address. This list used to select the
 * legacy column alone, so every performer who had uploaded a picture came back
 * with `avatarUrl: null` and the roster drew them faceless. Both spellings are
 * asserted here, because a fix that always signs and never falls back would be
 * the same bug read from the other end.
 */
describe("participants — the roster's pictures", () => {
  it("signs an UPLOADED avatar, and still serves a legacy external one", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("face");

    // The uploaded picture, written exactly as `POST /files/upload-url` would:
    // owned by the performer's profile, inside that profile's storage folder.
    const [file] = await db
      .insert(schema.files)
      .values({
        ownerUserId: "face-perf",
        ownerProfileId: performer.profileId,
        kind: "photo",
        path: `profiles/${performer.profileId}/media/avatar.png`,
        contentType: "image/png",
        sizeBytes: 2048,
      })
      .returning();
    if (!file) throw new Error("file seed failed");
    await db
      .update(schema.profiles)
      .set({ avatarFileId: file.id, avatarUrl: null })
      .where(eq(schema.profiles.id, performer.profileId));

    // The host keeps the OLD shape — an external address, no file.
    await db
      .update(schema.profiles)
      .set({ avatarFileId: null, avatarUrl: "https://example.test/host.png" })
      .where(eq(schema.profiles.id, operator.profileId));

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      status: "confirmed",
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("face-op"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { profileId: string; avatarUrl: string | null }[];

    // The uploaded one arrives as a URL minted from the FILE'S PATH. This suite's
    // signer is the offline fake, so the assertion is on the shape — what it
    // proves is that the response went through the signer at all.
    const performerRow = rows.find((row) => row.profileId === performer.profileId);
    expect(performerRow?.avatarUrl).toBe(
      `https://fake.storage.local/download/${encodeURIComponent(file.path)}`,
    );

    // And the legacy address is passed straight through, unsigned — there is no
    // file to sign, and it was never ours to serve bytes for.
    const hostRow = rows.find((row) => row.profileId === operator.profileId);
    expect(hostRow?.avatarUrl).toBe("https://example.test/host.png");
  });
});

describe("participants — crew sponsor stamp (decisions #12)", () => {
  it("stamps the adder as the sponsor when crew is added directly", async () => {
    const { db } = harness;
    const { event, hostParticipant } = await seedEventWithHost("crew-sp");
    const crew = await seedMemberWithSet(
      "crew-sp-c",
      "performer",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("crew-sp-op"), // the operator/host
      payload: { profileId: crew.profileId, role: "crew" },
    });
    expect(added.statusCode).toBe(201);

    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, crew.profileId),
        ),
      );
    // Sponsored by the host → operator-scope rider reach when granted rider.view.
    expect((row?.details as { sponsorParticipantId: string }).sponsorParticipantId).toBe(
      hostParticipant.id,
    );
  });

  it("does not stamp a sponsor on a non-crew participant", async () => {
    const { db } = harness;
    const { event, performer } = await seedEventWithHost("nocrew-sp");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("nocrew-sp-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(row?.details ?? null).toBeNull();
  });
});

describe("participants — the grant_admin entitlement gate (paid plans only)", () => {
  /** A permission set owned by `profileId`, carrying `capabilities`. */
  async function seedPermissionSet(
    profileId: string,
    name: string,
    capabilities: readonly string[],
  ) {
    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({ profileId, name, capabilities: [...capabilities] })
      .returning();
    if (!set) throw new Error("permission set seed failed");
    return set.id;
  }

  it("403s a FREE host handing a performer an admin-grade set, and writes no participant", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-free");
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-free-op"),
      payload: {
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: adminSetId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const rows = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("lets a PAID host hand out the same admin-grade set", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-paid");
    await harness.db
      .insert(schema.plans)
      .values({ profileId: operator.profileId, tier: "operator_pro" });
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-paid-op"),
      payload: {
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: adminSetId,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().permissionSetId).toBe(adminSetId);
  });

  it("403s the same grant made by UPDATE — the back door into event admin", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("ga-patch");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        status: "confirmed",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("ga-patch-op"),
      payload: { permissionSetId: adminSetId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const [after] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(after?.permissionSetId).toBe(performer.permissionSetId);
  });

  it("never charges a free host for an ordinary performer / crew / agent set", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-plain");
    const crewSetId = await seedPermissionSet(
      operator.profileId,
      "crew_technical",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-plain-op"),
      payload: {
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    });
    expect(added.statusCode).toBe(201);

    // Swapping between non-admin sets stays free, on both write paths.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${added.json().id}`,
      headers: auth("ga-plain-op"),
      payload: { permissionSetId: crewSetId },
    });
    expect(patched.statusCode).toBe(200);

    /*
     * The agent here needs somebody on the event to act for (QA7-7), so the fixture
     * signs them to the performer added above. It used to be a PERFORMER-kind profile
     * representing nobody, which the write now refuses — an impossible state that this
     * test only ever passed through on its way to the entitlement question it is really
     * asking. The subject is unchanged: an agent set is not an admin-grade grant.
     */
    const agentProfile = await seedMemberWithSet("ga-plain-agent", "agent", ["event.view"]);
    await harness.db.insert(schema.representations).values({
      agentProfileId: agentProfile.profileId,
      performerProfileId: performer.profileId,
      region: ["SE"],
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    const addedAgent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-plain-op"),
      payload: { profileId: agentProfile.profileId, role: "agent", permissionSetId: agentSetId },
    });
    expect(addedAgent.statusCode).toBe(201);
  });

  /**
   * AN AGENT NEEDS SOMEBODY HERE TO ACT FOR (QA sweep run 7, QA7-7).
   *
   * Added to an event none of their artists is on, an agent used to get 201 and a
   * permanent `invited` row, plus a notification promising access, over a participation
   * that answered 404 to the event, the accept and the deals. The rule already existed on
   * the auto-assign path (`assignAgentToEvent`: "you can only delegate what you hold")
   * and this route never went near it.
   */
  it("refuses an agent who represents nobody on the event", async () => {
    const { operator, event } = await seedEventWithHost("agent-stranger");
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );
    const stranger = await seedMemberWithSet("agent-stranger-a", "agent", ["event.view"]);

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("agent-stranger-op"),
      payload: { profileId: stranger.profileId, role: "agent", permissionSetId: agentSetId },
    });

    expect(added.statusCode).toBe(400);
    expect(added.json().error.message).toContain("represents nobody on this event");

    // And nothing was written — the defect was the leftover row as much as the 201.
    const rows = await harness.db
      .select({ id: schema.eventParticipants.id })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, stranger.profileId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("refuses an agent whose act is on ANOTHER event, not this one", async () => {
    const { operator, event } = await seedEventWithHost("agent-elsewhere");
    const other = await seedEventWithHost("agent-elsewhere-other");
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );
    const agentProfile = await seedMemberWithSet("agent-elsewhere-a", "agent", ["event.view"]);
    /*
     * The act must really be STANDING on the other bill for this to test anything.
     * `seedEventWithHost` seeds the host alone, so without this insert the act is on no
     * event at all and the case degenerates into the previous test — which is exactly
     * what a mutation caught: dropping the event from the join survived, because nothing
     * here had ever put a represented act on a DIFFERENT event.
     */
    await harness.db.insert(schema.eventParticipants).values({
      eventId: other.event.id,
      profileId: other.performer.profileId,
      role: "performer",
      permissionSetId: other.performer.permissionSetId,
      status: "confirmed",
    });
    // A real, active representation — of somebody who is standing on a different bill.
    await harness.db.insert(schema.representations).values({
      agentProfileId: agentProfile.profileId,
      performerProfileId: other.performer.profileId,
      region: ["SE"],
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("agent-elsewhere-op"),
      payload: { profileId: agentProfile.profileId, role: "agent", permissionSetId: agentSetId },
    });

    expect(added.statusCode).toBe(400);
  });

  it("refuses an agent whose act has been REMOVED from the event", async () => {
    // A removed participation is not standing on the bill, so it delegates nothing —
    // and the agent projected from it would be the same unanswerable row this refuses.
    const { operator, performer, event } = await seedEventWithHost("agent-removed");
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "removed",
    });
    const agentProfile = await seedMemberWithSet("agent-removed-a", "agent", ["event.view"]);
    await harness.db.insert(schema.representations).values({
      agentProfileId: agentProfile.profileId,
      performerProfileId: performer.profileId,
      region: ["SE"],
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("agent-removed-op"),
      payload: { profileId: agentProfile.profileId, role: "agent", permissionSetId: agentSetId },
    });

    expect(added.statusCode).toBe(400);
  });

  it("refuses an agent whose representation has been terminated", async () => {
    const { operator, performer, event } = await seedEventWithHost("agent-ended");
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("agent-ended-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const agentProfile = await seedMemberWithSet("agent-ended-a", "agent", ["event.view"]);
    /*
     * `status: "active"` with a termination whose moment has PASSED. This is the case
     * `status` alone gets wrong (A-19), and the reason the check runs the row through
     * `isRepresentationActiveAt` rather than trusting the column.
     */
    await harness.db.insert(schema.representations).values({
      agentProfileId: agentProfile.profileId,
      performerProfileId: performer.profileId,
      region: ["SE"],
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
      terminatedEffectiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("agent-ended-op"),
      payload: { profileId: agentProfile.profileId, role: "agent", permissionSetId: agentSetId },
    });

    expect(added.statusCode).toBe(400);
  });
});

/**
 * The three limits ClickUp 86cbazcc7 recorded, each of which forced the roster UI
 * to STATE a restriction rather than offer a control:
 *
 *   1. `permissionSetId` was optional but not nullable, so access could only ever
 *      go up — a collaborator promoted to full control could never be demoted.
 *   2. Nothing listed the permission sets, and a participant serialized to a bare
 *      id, so the UI could only guess at authority by comparing ids against the
 *      host's — and got the seeded co-host wrong.
 *   3. The soft remove wrote `removed` over the previous status, so there was
 *      nothing to restore a row TO and the confirm could not offer an undo.
 */
describe("participants — permission sets can come back down", () => {
  it("clears a participant's permission set when sent null", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("lower");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: operator.permissionSetId,
        status: "accepted",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("lower-op"),
      payload: { permissionSetId: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissionSetId).toBeNull();

    // The row itself, not just the response — a serializer can lie about a write.
    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(row?.permissionSetId).toBeNull();
  });

  /**
   * Lowering must not be charged. `assertGrantAdminAllows` returns early on a null
   * next-set, so a FREE host can always take admin authority away — which matters
   * because the same host is 403'd for handing it out.
   */
  it("lets a FREE host demote a collaborator who holds an admin-grade set", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("lower-free");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "co_host",
        // operator_full — the set the free plan is 403'd for GRANTING.
        permissionSetId: operator.permissionSetId,
        status: "accepted",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("lower-free-op"),
      payload: { permissionSetId: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().permissionSetId).toBeNull();
  });

  /** Omitting the field still means "leave it alone" — the old behaviour intact. */
  it("leaves the set untouched when the field is omitted entirely", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("lower-omit");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: operator.permissionSetId,
        status: "accepted",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("lower-omit-op"),
      payload: { performerTag: "headliner" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().permissionSetId).toBe(operator.permissionSetId);
  });
});

describe("participants — the roster names the permission set, never guesses it", () => {
  /**
   * THE BUG THIS CLOSES. Two DIFFERENT permission-set rows can carry identical
   * capabilities — the seeded co-host holds set `c6`, a separate row with the same
   * `operator_full` list as the host's. Comparing ids, the UI called that
   * "Standard for the role" while the holder had full control. Comparing
   * CAPABILITIES, which is what the response now carries, it cannot.
   */
  it("serializes the set's name and capabilities, so two equal sets read as equal", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("named");

    // A second row, different id, identical authority — the co-host's own set.
    const [coHostSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: performer.profileId,
        name: "Co-host full",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    if (!coHostSet) throw new Error("permission set seed failed");

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "co_host",
      permissionSetId: coHostSet.id,
      status: "accepted",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("named-op"),
    });
    expect(response.statusCode).toBe(200);

    const rows = response.json();
    const coHost = rows.find((row: { role: string }) => row.role === "co_host");
    const host = rows.find((row: { role: string }) => row.role === "host");

    expect(coHost.permissionSet.name).toBe("Co-host full");
    expect(coHost.permissionSet.isPreset).toBe(false);
    // Different ids, same authority — and the response says so.
    expect(coHost.permissionSetId).not.toBe(host.permissionSetId);
    expect([...coHost.permissionSet.capabilities].sort()).toEqual(
      [...host.permissionSet.capabilities].sort(),
    );
    expect(coHost.permissionSet.capabilities).toContain("participants.manage");
  });

  it("omits the set entirely for a participant who holds none", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("named-none");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      status: "accepted",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("named-none-op"),
    });
    const row = response
      .json()
      .find((participant: { role: string }) => participant.role === "performer");
    expect(row.permissionSetId).toBeNull();
    expect(row.permissionSet).toBeUndefined();
  });

  /**
   * The set is operator-tier. Naming it to an arm's-length party would tell them
   * how the host's access is arranged — the same reason the bare id was already
   * withheld from them.
   */
  it("tells a performer nothing about anyone's permission set", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("named-perf");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      status: "accepted",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("named-perf-perf"),
    });
    expect(response.statusCode).toBe(200);
    for (const row of response.json()) {
      expect(row.permissionSet).toBeUndefined();
      expect(row.permissionSetId).toBeUndefined();
    }
  });
});

describe("participants — GET /events/:id/permission-sets", () => {
  it("lists the system presets and the HOST's own sets, and nobody else's", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("sets");

    const [preset] = await db
      .insert(schema.permissionSets)
      .values({ profileId: null, name: "Schedule only", capabilities: ["event.view"] })
      .returning();
    if (!preset) throw new Error("preset seed failed");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/permission-sets`,
      headers: auth("sets-op"),
    });
    expect(response.statusCode).toBe(200);

    const ids = response.json().map((row: { id: string }) => row.id);
    expect(ids).toContain(preset.id);
    expect(ids).toContain(operator.permissionSetId);
    // The PERFORMER's own set belongs to their account, not to this event's host.
    expect(ids).not.toContain(performer.permissionSetId);
  });

  it("marks a system preset as one and a host's own set as not", async () => {
    const { db } = harness;
    const { operator, event } = await seedEventWithHost("sets-flag");
    const [preset] = await db
      .insert(schema.permissionSets)
      .values({ profileId: null, name: "Crew only", capabilities: ["event.view"] })
      .returning();
    if (!preset) throw new Error("preset seed failed");

    const rows = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/permission-sets`,
        headers: auth("sets-flag-op"),
      })
    ).json();

    expect(rows.find((row: { id: string }) => row.id === preset.id).isPreset).toBe(true);
    expect(rows.find((row: { id: string }) => row.id === operator.permissionSetId).isPreset).toBe(
      false,
    );
  });

  /**
   * Gated on `participants.manage` — the capability that lets a caller ASSIGN one.
   * Reading the list is not less sensitive than assigning from it.
   */
  it("403s a performer on the bill", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("sets-403");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      status: "accepted",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/permission-sets`,
      headers: auth("sets-403-perf"),
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns capabilities as a real list, so the UI can read authority off it", async () => {
    const { event } = await seedEventWithHost("sets-caps");
    const rows = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/permission-sets`,
        headers: auth("sets-caps-op"),
      })
    ).json();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Array.isArray(row.capabilities)).toBe(true);
      expect(typeof row.name).toBe("string");
    }
  });
});

describe("participants — a removal remembers what it undid", () => {
  /** Seed a participant at `status`, ready to be removed. */
  async function seedRemovable(prefix: string, status: "invited" | "accepted" | "confirmed") {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost(prefix);
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: performer.profileId, role: "performer", status })
      .returning();
    if (!participant) throw new Error("participant seed failed");
    return { event, participant };
  }

  it("keeps the prior status on the row, and reports it as the restore target", async () => {
    const { event, participant } = await seedRemovable("undo", "confirmed");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-op"),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().status).toBe("removed");
    expect(removed.json().statusBeforeRemoval).toBe("confirmed");

    const [row] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(row?.statusBeforeRemoval).toBe("confirmed");
  });

  /**
   * The three statuses a removal used to flatten into one. Each has to come back
   * as itself, or the undo restores a booking to a state it was never in.
   */
  it("distinguishes the statuses a removal used to flatten", async () => {
    for (const status of ["invited", "accepted", "confirmed"] as const) {
      const { event, participant } = await seedRemovable(`undo-${status}`, status);
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/events/${event.id}/participants/${participant.id}`,
        headers: auth(`undo-${status}-op`),
      });
      expect(removed.json().statusBeforeRemoval).toBe(status);
    }
  });

  it("restores the row and retires the memory of the removal", async () => {
    const { event, participant } = await seedRemovable("undo-restore", "accepted");
    await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-restore-op"),
    });

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-restore-op"),
      payload: { status: "accepted" },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().status).toBe("accepted");
    // Not "accepted" — a row that is no longer removed has no restore target, and
    // a leftover value would be a second, older opinion about the same row.
    expect(restored.json().statusBeforeRemoval).toBeNull();

    const [row] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(row?.statusBeforeRemoval).toBeNull();
  });

  /**
   * Removing an already-removed row must not record `removed` as the thing to
   * restore to — that would quietly turn the undo into a no-op.
   */
  it("does not overwrite the memory when a removed row is removed again", async () => {
    const { event, participant } = await seedRemovable("undo-twice", "confirmed");
    await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-twice-op"),
    });
    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-twice-op"),
    });
    expect(second.json().statusBeforeRemoval).toBe("confirmed");
  });

  /**
   * An edit that is not a restore leaves the undo intact — otherwise correcting a
   * removed row's performer tag would silently destroy the only way back.
   */
  it("keeps the memory through an edit that does not change the status", async () => {
    const { event, participant } = await seedRemovable("undo-edit", "confirmed");
    await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-edit-op"),
    });

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("undo-edit-op"),
      payload: { performerTag: "opener" },
    });
    expect(edited.json().status).toBe("removed");
    expect(edited.json().statusBeforeRemoval).toBe("confirmed");
  });

  /** A row that was never removed offers no undo, and says so with null. */
  it("reports no restore target for a row that is not removed", async () => {
    const { event, participant } = await seedRemovable("undo-live", "accepted");
    const rows = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/participants`,
        headers: auth("undo-live-op"),
      })
    ).json();
    const row = rows.find((one: { id: string }) => one.id === participant.id);
    expect(row.statusBeforeRemoval).toBeNull();
  });
});

/**
 * ── THE INVITATION GATE (ClickUp 86cbcehmp, symptom 123qy9rnf87) ────────────
 *
 * Ran: *"Invited users should first have the option to 'Accept invite' -
 * currently the invited party gets invited to an event → gets access to the
 * event manager as a collaborator immediately → stays as 'Invited'."*
 *
 * `event_participants.status` existed and advanced nowhere; authorization asked
 * only `status <> 'removed'`. These tests pin the rule in BOTH directions,
 * because a suite that only proves "an accepted participant can read the event"
 * stays green with the gate deleted — which is precisely the shape of bug this
 * repo keeps finding (CLAUDE.md, "Green is not the same as correct").
 */
/**
 * NOBODY INVITED THE PEOPLE RUNNING THE NIGHT (QA sweep run 6, QA6-7).
 *
 * `POST /events/:id/participants` left every role at the column default `invited`.
 * That is right for a role with somewhere to answer, and a dead end for a co-host:
 * the inbox deliberately excludes them (*"The host and a co-host are running it —
 * nobody invited them to it"*), so `resolvePendingParticipation` could not find the
 * row and the accept route answered **404 "Event not found"** — as did the event
 * itself, because `invited` grants no capabilities. The co-promoter could neither see
 * the night nor answer for it, and only the host patching their status by hand got
 * them in.
 */
/**
 * A WRITE ANSWERS THE SAME SHAPE A READ DOES (QA sweep run 6, QA6-8).
 *
 * `ParticipantResponse` declares `name`, `avatarUrl`, `genres` and `publicSlug`, and
 * the write path never joined `profiles` to fill them — so adding Marlo Vance answered
 * `"name": null` while the list one call later answered `"Marlo Vance"`. A screen that
 * renders the mutation result showed a blank row until something else refetched.
 */
describe("participants — the row a write answers with carries its face", () => {
  it("names the profile on POST, exactly as the list does", async () => {
    const { event, operator, performer } = await seedEventWithHost("rowface");
    // The seed's profiles are named after their uid; give this one a real name and a
    // public page so every declared display field has something to carry.
    await harness.db
      .update(schema.profiles)
      .set({ name: "Marlo Vance", slug: "rowface-marlo-vance", isPublic: true })
      .where(eq(schema.profiles.id, performer.profileId));

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("rowface-op"), "x-profile-id": operator.profileId },
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().name).toBe("Marlo Vance");
    expect(added.json().publicSlug).toBe("rowface-marlo-vance");

    // The same row, read back: the two must agree, which is the whole assertion.
    const listed = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/participants`,
        headers: { ...auth("rowface-op"), "x-profile-id": operator.profileId },
      })
    )
      .json()
      .find((row: { id: string }) => row.id === added.json().id);
    expect(listed.name).toBe(added.json().name);
    expect(listed.publicSlug).toBe(added.json().publicSlug);
  });

  it("names the profile on PATCH too", async () => {
    const { event, operator, performer } = await seedEventWithHost("facepatch");
    await harness.db
      .update(schema.profiles)
      .set({ name: "Neon Tide" })
      .where(eq(schema.profiles.id, performer.profileId));
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("facepatch-op"), "x-profile-id": operator.profileId },
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${added.json().id}`,
      headers: { ...auth("facepatch-op"), "x-profile-id": operator.profileId },
      payload: { role: "support" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().role).toBe("support");
    expect(patched.json().name).toBe("Neon Tide");
  });
});

describe("participants — a co-promoter added directly is on the bill, not in a queue", () => {
  it("records a co-host as accepted, so they can read the event at once", async () => {
    const { event, operator } = await seedEventWithHost("cohoststatus");
    const coHost = await seedMemberWithSet(
      "cohoststatus-co",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("cohoststatus-op"), "x-profile-id": operator.profileId },
      payload: { profileId: coHost.profileId, role: "co_host" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().status).toBe("accepted");

    // The read that used to 404: `invited` grants no capabilities at all.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("cohoststatus-co"), "x-profile-id": coHost.profileId },
    });
    expect(read.statusCode).toBe(200);
  });

  it("still puts a PERFORMER in the queue — they are being asked", async () => {
    // The distinction this rests on. A performer has an inbox row, an accept route
    // and a decline route; the whole booking ladder is their answer.
    const { event, operator, performer } = await seedEventWithHost("perfstatus");
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("perfstatus-op"), "x-profile-id": operator.profileId },
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().status).toBe("invited");
  });

  it("still puts CREW in the queue — they answer too", async () => {
    const { event, operator } = await seedEventWithHost("crewstatus");
    const crew = await seedMemberWithSet(
      "crewstatus-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: { ...auth("crewstatus-op"), "x-profile-id": operator.profileId },
      payload: { profileId: crew.profileId, role: "crew" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().status).toBe("invited");
  });
});

describe("participants — an invitation must be answered", () => {
  /**
   * THE BELL SAYS WHOSE INVITATION IT WAS (QA sweep run 14).
   *
   * These rows read "Invitation accepted — Roster Night" over a BLANK second line, because the
   * body was `note || undefined` and the note is optional. On a six-party bill the operator could
   * not tell which invitation had been answered — the one fact the row exists to carry. In
   * Postgres: `body = ''`, `actor_display = ''`.
   *
   * Both fields asserted, and both DIRECTIONS of the answer, because a title that named the
   * person only on the accept path would pass a test written for the accept path.
   */
  /*
   * AND IT ACCEPTS A REQUEST WITH NO BODY AT ALL (QA sweep run 14).
   *
   * `400 "body/ Expected object, received null"` — a booking refused on the grounds of punctuation.
   * Every field of the body is optional, so "no body" and "{}" are the same request. The web client
   * always sends an object, which is why no screen ever hit it.
   */
  it("accepts an invitation with no body at all, not only with {}", async () => {
    const { performer, event } = await seedEventWithHost("nobody");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/participants`,
          headers: auth("nobody-op"),
          payload: { profileId: performer.profileId, role: "performer" },
        })
      ).statusCode,
    ).toBe(201);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("nobody-perf"),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("accepted");
  });

  it("names the party who answered and the person who pressed it", async () => {
    const { performer, event } = await seedEventWithHost("notifyname");
    const { db } = harness;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/participants`,
          headers: auth("notifyname-op"),
          payload: { profileId: performer.profileId, role: "performer" },
        })
      ).statusCode,
    ).toBe(201);

    // NO NOTE — the common case, and the one that used to leave the row half empty.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/participation/accept`,
          headers: auth("notifyname-perf"),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const [accepted] = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, "notifyname-op"),
          eq(schema.notifications.type, "event.invitation_accepted"),
        ),
      );
    expect(accepted?.title).toBe("notifyname-perf accepted — Roster Night");
    // The second line is never blank now, note or no note.
    expect(accepted?.body).toBe("They are on the bill.");
    // And the "by …" line every other row in the bell carries. It is the ACTOR, which on a
    // delegated accept is the agent rather than the act — two different people, which is why
    // the title and this are separate fields.
    expect(accepted?.actorDisplay).toBe("notifyname-perf");
  });

  it("names the party who declined, and carries their note when they leave one", async () => {
    const { performer, event } = await seedEventWithHost("notifyno");
    const { db } = harness;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/participants`,
          headers: auth("notifyno-op"),
          payload: { profileId: performer.profileId, role: "performer" },
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${event.id}/participation/decline`,
          headers: auth("notifyno-perf"),
          payload: { note: "Already booked that night." },
        })
      ).statusCode,
    ).toBe(200);

    const [declined] = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, "notifyno-op"),
          eq(schema.notifications.type, "event.invitation_declined"),
        ),
      );
    expect(declined?.title).toBe("notifyno-perf declined — Roster Night");
    // The note WINS over the standing sentence — it is the person's own words.
    expect(declined?.body).toBe("Already booked that night.");
    expect(declined?.actorDisplay).toBe("notifyno-perf");
  });

  it("gives an invited participant NOTHING until they answer, then everything", async () => {
    const { operator, performer, event } = await seedEventWithHost("gate");

    // Added through the real route, so the status is whatever production writes.
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("gate-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().status).toBe("invited");

    // ── Half one: invited reads nothing. Delete the gate and this goes red. ──
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("gate-perf"),
    });
    expect(before.statusCode).toBe(404);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("gate-perf"),
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("accepted");

    // ── Half two: answered reads the event. Over-tighten and this goes red. ──
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("gate-perf"),
    });
    expect(after.statusCode).toBe(200);

    // The operator never lost their own event to the gate — the host row is
    // `confirmed` from creation, which is the reason this is safe to ship.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("gate-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(operator.profileId).toBeTruthy();
  });

  it("closes the event again when the invitation is declined, and records the note", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("decl");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("decl-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/decline`,
      headers: auth("decl-perf"),
      payload: { note: "Already booked that night" },
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().status).toBe("declined");

    // Declined is outside the standing set too — saying no must not leave the
    // books open. (The row stays, so the operator can see who said no.)
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("decl-perf"),
    });
    expect(after.statusCode).toBe(404);

    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(row?.status).toBe("declined");

    // Ran asked for the reason to be capturable — it reaches the activity feed,
    // which is where the operator finds out WHY rather than merely that.
    // Scoped to THIS event. Unscoped it matched the first `participant.declined` row in the
    // whole database, so a second decline test anywhere in this file decided its answer — which
    // is exactly what happened when one was added.
    const [activity] = await db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.type, "participant.declined"),
          eq(schema.activityLog.eventId, event.id),
        ),
      );
    expect((activity?.summary as { note?: string } | null)?.note).toBe("Already booked that night");
  });

  it("refuses to answer twice, and refuses a stranger with 404 rather than 403", async () => {
    const { performer, event } = await seedEventWithHost("twice");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("twice-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("twice-perf"),
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("twice-perf"),
      payload: {},
    });
    expect(second.statusCode).toBe(409);

    // Somebody with no invitation must not learn the event exists from the
    // shape of the refusal.
    const stranger = await seedMemberWithSet(
      "twice-stranger",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    expect(stranger.profileId).toBeTruthy();
    const asStranger = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("twice-stranger"),
      payload: {},
    });
    expect(asStranger.statusCode).toBe(404);
  });

  it("lists an unanswered invitation, and keeps it under Accepted once answered", async () => {
    const { performer, event } = await seedEventWithHost("list");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("list-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/me/event-invitations",
      headers: auth("list-perf"),
    });
    expect(pending.statusCode).toBe(200);
    const items = pending.json() as Array<{ eventId: string; title: string | null }>;
    expect(items.map((one) => one.eventId)).toEqual([event.id]);
    expect(items[0]?.title).toBe("Roster Night");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("list-perf"),
      payload: {},
    });

    // The row STAYS, re-tagged — the Requests inbox needs an Accepted tab, and
    // the screens that only want unanswered ones (the Events card, the calendar
    // marker) filter on `requestStatus` rather than on the row's absence.
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/me/event-invitations",
      headers: auth("list-perf"),
    });
    expect(after.json()).toMatchObject([{ requestStatus: "accepted" }]);

    // The operator is not "invited" to their own event, so nothing lands here
    // for them — this list is invitations addressed to you, not a second events
    // feed. Their participation is `host`, which is outside INVITABLE_ROLES.
    const forOperator = await app.inject({
      method: "GET",
      url: "/api/v1/me/event-invitations",
      headers: auth("list-op"),
    });
    expect(forOperator.json()).toEqual([]);
  });

  /**
   * A CANCELLED SHOW STOPS ASKING — QA sweep run 5, QA5-2.
   *
   * An agent and a performer were both still shown *"You have an invitation — Accept /
   * Decline"* for a night the operator had called off, with nothing on the card saying so.
   * The cancellation took the public page down and notified every party, and left this
   * question standing.
   *
   * Derived from `events.status`, like `expired` and for the same reason the expiry note
   * gives: a stored state would need a sweep to stay truthful.
   */
  it("reports an invitation to a CANCELLED show as cancelled, not pending", async () => {
    const { performer, event } = await seedEventWithHost("cancel-inv");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("cancel-inv-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/me/event-invitations",
          headers: auth("cancel-inv-perf"),
        })
      ).json(),
    ).toMatchObject([{ requestStatus: "pending" }]);

    const cancelled = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("cancel-inv-op"),
      payload: { status: "cancelled", cancellationReason: "The room flooded" },
    });
    expect(cancelled.statusCode).toBe(200);

    // The row stays — the act can still see what happened to it — but it no longer
    // claims to be a question. The Events screen filters on `pending`, so the
    // "Accept / Decline" card disappears there by construction.
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/me/event-invitations",
      headers: auth("cancel-inv-perf"),
    });
    expect(after.json()).toMatchObject([{ requestStatus: "cancelled" }]);
  });

  /*
   * AN INVITATION TO A CANCELLED EVENT CANNOT BE ACCEPTED — decisions §25.9.9, Daniel 2026-09-29,
   * AGAINST §25.6's own recommendation (which argued a cancelled event can be reinstated, so an
   * acceptance standing against one is what the operator wants when it is).
   *
   * THE LOCK, and its second half is the point. The ruling names the ACCEPTANCE and only the
   * acceptance, so declining stays open: §25.6's argument against refusing was that a blanket
   * refusal also costs the performer the answer they are most likely to want on record, and reading
   * the ruling narrowly honours it and avoids that cost. A test that only asserted the refusal
   * would pass just as well if declining had been shut too, which is the version of this that gets
   * shipped by accident.
   */
  it("refuses to ACCEPT an invitation to a cancelled event, and still takes the decline", async () => {
    const { performer, event } = await seedEventWithHost("cancel-answer");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("cancel-answer-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/events/${event.id}`,
          headers: auth("cancel-answer-op"),
          payload: { status: "cancelled", cancellationReason: "The room flooded" },
        })
      ).statusCode,
    ).toBe(200);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("cancel-answer-perf"),
      payload: {},
    });
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json().error.message).toContain("nothing to accept");

    // AND NO ROW WAS WRITTEN BEHIND THE REFUSAL. A 409 over a participation that had already been
    // set to `accepted` would be the worst of both, and the guard runs before the write for that
    // reason.
    const [row] = await harness.db
      .select({ status: schema.eventParticipants.status })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(row?.status).toBe("invited");

    // THE HALF THE RULING DELIBERATELY LEAVES OPEN.
    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/decline`,
      headers: auth("cancel-answer-perf"),
      payload: {},
    });
    expect(declined.statusCode).toBe(200);
    const [afterDecline] = await harness.db
      .select({ status: schema.eventParticipants.status })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(afterDecline?.status).toBe("declined");
  });

  /*
   * AND IT IS NOT NEW-FOUND STRICTNESS: a LIVE event still accepts. The shape that has caught this
   * repo repeatedly is a guard that refuses too much and passes a naive test.
   */
  it("still accepts an invitation to an event that is not cancelled", async () => {
    const { performer, event } = await seedEventWithHost("cancel-live");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("cancel-live-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("cancel-live-perf"),
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
  });

  it("keeps an answered invitation, tagged for the tab it belongs in", async () => {
    const { performer, event } = await seedEventWithHost("tabs");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("tabs-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const read = async () =>
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/me/event-invitations",
          headers: auth("tabs-perf"),
        })
      ).json() as Array<{ status: string; requestStatus: string }>;

    expect(await read()).toMatchObject([{ status: "invited", requestStatus: "pending" }]);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("tabs-perf"),
      payload: {},
    });

    // Still listed, now under Accepted — Ran: it "stays in the 'Accepted' tab of
    // the incoming requests until Expired". Dropping it on accept is the obvious
    // wrong thing, and this is the assertion that stops it.
    expect(await read()).toMatchObject([{ status: "accepted", requestStatus: "accepted" }]);
  });

  it("calls an invitation expired once its night has passed, without a sweep", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("expiry");

    await db
      .update(schema.events)
      .set({ eventDate: "2020-01-01" })
      .where(eq(schema.events.id, event.id));

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("expiry-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const rows = (
      await app.inject({
        method: "GET",
        url: "/api/v1/me/event-invitations",
        headers: auth("expiry-perf"),
      })
    ).json() as Array<{ status: string; requestStatus: string }>;

    // Unanswered, but the night is gone. Derived from the date rather than stored,
    // so the inbox is truthful without a job having run.
    expect(rows).toMatchObject([{ status: "invited", requestStatus: "expired" }]);
  });
});

/**
 * ── THE BOOKING LADDER, THROUGH THE REAL ROUTES (86cbcehmp) ────────────────
 *
 * `event-status-ladder.test.ts` asserts the RULE exhaustively and without a
 * database. This asserts the WIRING: that the routes actually call it, on the
 * right roles, and that nothing else moves.
 */
describe("participants — the booking ladder", () => {
  /** Read an event's status straight from the table. */
  async function statusOf(eventId: string): Promise<string> {
    const [row] = await harness.db
      .select({ status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    return row?.status ?? "";
  }

  it("draft → suggested when an act is invited, → pending when they accept", async () => {
    const { performer, event } = await seedEventWithHost("ladder");
    expect(await statusOf(event.id)).toBe("draft");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ladder-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(await statusOf(event.id)).toBe("suggested");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("ladder-perf"),
      payload: {},
    });
    expect(await statusOf(event.id)).toBe("pending");
  });

  it("does NOT move the event when the invitee is crew, not an act", async () => {
    const { event } = await seedEventWithHost("crewladder");
    const crew = await seedMemberWithSet("crewladder-crew", "team_and_crew", [
      "event.view",
      "schedule.view",
    ]);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("crewladder-op"),
      payload: { profileId: crew.profileId, role: "crew" },
    });

    // Booking a sound engineer is not suggesting the night to anybody. This is
    // the assertion that would stay green if the role filter were dropped and
    // every crew add started moving the booking, so it is stated on its own.
    expect(await statusOf(event.id)).toBe("draft");
  });

  it("leaves the event alone when the invitation is declined", async () => {
    const { performer, event } = await seedEventWithHost("declladder");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("declladder-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(await statusOf(event.id)).toBe("suggested");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/decline`,
      headers: auth("declladder-perf"),
      payload: { note: "no" },
    });

    // Ran's spec for a refusal is a notification and the operator deciding what
    // to do next, NOT a status change. Reverting to `draft` here would be an
    // invented rule, and it would fight "the operator can edit it to change the
    // date" — which is an action on a suggested event.
    expect(await statusOf(event.id)).toBe("suggested");
  });

  it("does not drag a live booking backwards when a second act is added", async () => {
    const { performer, event } = await seedEventWithHost("second");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("second-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("second-perf"),
      payload: {},
    });
    expect(await statusOf(event.id)).toBe("pending");

    const support = await seedMemberWithSet("second-support", "performer", [
      ...PRESET_PERMISSION_SETS.performer,
    ]);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("second-op"),
      payload: { profileId: support.profileId, role: "support" },
    });

    // Still pending — adding a support act to a night an act has already agreed
    // to must not reopen the question.
    expect(await statusOf(event.id)).toBe("pending");
  });
});

/**
 * THE LEAK THE BROWSER FOUND (86cbcehmp).
 *
 * `GET /events` resolves reachability with its own SQL rather than through
 * `effectiveEventCapabilities`, so when `invited` stopped granting capabilities
 * that copy did not hear about it: the invited performer got a 404 opening the
 * event and still saw its title, venue, date, capacity and co-billing on their
 * events list. Four green full-suite runs did not catch it, because nothing
 * asserted the list and the gate agree.
 *
 * That is the assertion here — not "the list is filtered", but "the list and the
 * door give the same answer". A test of either alone would have stayed green.
 */
describe("participants — the events list and the gate must agree", () => {
  it("hides an unanswered invitation from GET /events, and reveals it on accept", async () => {
    const { performer, event } = await seedEventWithHost("leak");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("leak-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });

    const titles = async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: auth("leak-perf"),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const items = (Array.isArray(body) ? body : body.items) as Array<{ id: string }>;
      return items.map((one) => one.id);
    };
    const canOpen = async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/participants`,
        headers: auth("leak-perf"),
      });
      return response.statusCode;
    };

    // Invited: absent from the list AND shut out. The two halves together are
    // the point — either one alone passes with the bug present.
    expect(await titles()).not.toContain(event.id);
    expect(await canOpen()).toBe(404);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("leak-perf"),
      payload: {},
    });

    // Answered: present in the list AND open. Same two halves.
    expect(await titles()).toContain(event.id);
    expect(await canOpen()).toBe(200);
  });
});

/**
 * ── CHANGING A NIGHT SOMEBODY AGREED TO (ClickUp 86cbcftg3) ────────────────
 *
 * Driven through the real PATCH, so what is asserted is the behaviour an
 * operator actually gets from saving the event form — not a helper called
 * directly.
 */
describe("events — a change to a booked night is a question", () => {
  async function eventRow(eventId: string) {
    const [row] = await harness.db
      .select({ status: schema.events.status, eventDate: schema.events.eventDate })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    return row;
  }

  /** Operator invites the performer, performer accepts → a `pending` booking. */
  async function bookedEvent(prefix: string) {
    const seeded = await seedEventWithHost(prefix);
    await harness.db
      .update(schema.events)
      .set({ eventDate: "2026-09-12" })
      .where(eq(schema.events.id, seeded.event.id));
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.event.id}/participants`,
      headers: auth(`${prefix}-op`),
      payload: { profileId: seeded.performer.profileId, role: "performer" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.event.id}/participation/accept`,
      headers: auth(`${prefix}-perf`),
      payload: {},
    });
    return seeded;
  }

  /**
   * THE SAME FINDING AT ITS OTHER SURFACE — run 4's QA4-16: a cancelled show went on
   * asking three people to agree a new date. `superseded`, not `declined`, because nobody
   * refused anything: the question was overtaken by events.
   */
  it("closes a pending change request when the show is cancelled", async () => {
    const { event } = await bookedEvent("cancel-cr");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("cancel-cr-op"),
      payload: { eventDate: "2026-11-30" },
    });
    const proposals = await harness.db
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.eventId, event.id));
    expect(proposals.filter((row) => row.status === "pending")).toHaveLength(1);

    // An ALREADY ANSWERED question from earlier in the night's history. A cancellation
    // closes what is still open; it does not rewrite what the bill already decided, and
    // without this row the `status = pending` filter would be free to disappear.
    const [answered] = await harness.db
      .insert(schema.eventChangeRequests)
      .values({
        eventId: event.id,
        changes: { eventDate: "2026-10-01" },
        previous: { eventDate: "2026-09-12" },
        status: "confirmed",
        resolvedAt: new Date("2026-09-20T10:00:00Z"),
      })
      .returning({ id: schema.eventChangeRequests.id });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("cancel-cr-op"),
      payload: { status: "cancelled", cancellationReason: "Called off" },
    });

    const afterCancel = await harness.db
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.eventId, event.id));
    expect(afterCancel.filter((row) => row.status === "pending")).toHaveLength(0);
    expect(afterCancel.filter((row) => row.status === "superseded")).toHaveLength(1);
    expect(afterCancel.find((row) => row.id === answered?.id)?.status).toBe("confirmed");
    // And the caller who was waiting is not left with a live banner: the read route
    // answers with no open request.
    const open = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("cancel-cr-perf"),
      })
    ).json().request;
    expect(open).toBeNull();
  });

  /**
   * NOBODY TO ASK IS NOT THE SAME AS WAITING FOR AN ANSWER (QA sweep run 3).
   *
   * `resolveProposal` has always said a proposal with `required: 0` is confirmed,
   * and `event-change-rules.test.ts` pins it — but the DIVERSION never consulted
   * it. A confirmed event whose only participant is the operator had its date
   * stripped out of the PATCH and turned into a proposal nobody could answer:
   * `answerChangeRequest` is the only code that applies a change, so the night was
   * frozen for good and the pending row superseded every later attempt. That is the
   * state every event is in before anybody is invited to it, which is why a pure
   * unit test of the rule passed while the app could not move a date.
   */
  it("moves the date outright on an event whose only participant is the operator", async () => {
    const seeded = await seedEventWithHost("solomove");
    await harness.db
      .update(schema.events)
      .set({ status: "confirmed", eventDate: "2026-09-12" })
      .where(eq(schema.events.id, seeded.event.id));

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.event.id}`,
      headers: auth("solomove-op"),
      payload: { eventDate: "2026-10-20" },
    });
    expect(patched.statusCode).toBe(200);

    // The date moved, and no question was opened to wait on.
    expect((await eventRow(seeded.event.id))?.eventDate).toBe("2026-10-20");
    const open = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.event.id}/change-request`,
      headers: auth("solomove-op"),
    });
    expect(open.json().request).toBeNull();

    // And it is still movable a second time — the bug left a pending row behind
    // that superseded every later attempt.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.event.id}`,
      headers: auth("solomove-op"),
      payload: { eventDate: "2026-11-03" },
    });
    expect((await eventRow(seeded.event.id))?.eventDate).toBe("2026-11-03");
  });

  it("moves the date freely while the offer is unanswered, and re-asks it", async () => {
    const { performer, event } = await seedEventWithHost("freemove");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("freemove-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    // They say no to THAT night.
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/decline`,
      headers: auth("freemove-perf"),
      payload: { note: "busy" },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("freemove-op"),
      payload: { eventDate: "2026-10-01" },
    });
    expect(patched.statusCode).toBe(200);

    // Applied immediately — nobody had agreed to anything.
    expect((await eventRow(event.id))?.eventDate).toBe("2026-10-01");

    // And the refusal is reopened: Ran's "edit it to change the date -> which
    // will trigger a new incoming request with a new date". They said no to a
    // different night.
    const invitations = await app.inject({
      method: "GET",
      url: "/api/v1/me/event-invitations",
      headers: auth("freemove-perf"),
    });
    expect(invitations.json()).toMatchObject([{ status: "invited", requestStatus: "pending" }]);
  });

  it("turns the same edit into a proposal once the act has accepted", async () => {
    const { event } = await bookedEvent("ask");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ask-op"),
      payload: { title: "Renamed too", eventDate: "2026-09-19" },
    });
    expect(patched.statusCode).toBe(200);

    // The DATE did not move…
    expect((await eventRow(event.id))?.eventDate).toBe("2026-09-12");
    // …but the rest of the edit did. Refusing the whole PATCH would make
    // renaming a show impossible while a date question was open.
    expect(patched.json().title).toBe("Renamed too");

    const open = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("ask-perf"),
    });
    expect(open.json().request).toMatchObject({
      changes: { eventDate: "2026-09-19" },
      previous: { eventDate: "2026-09-12" },
      required: 1,
      confirmed: 0,
      answerable: true,
    });
  });

  it("applies the change when the act confirms it", async () => {
    const { event } = await bookedEvent("yes");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("yes-op"),
      payload: { eventDate: "2026-09-19" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("yes-perf"),
      })
    ).json().request.id;

    const answered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/confirm`,
      headers: auth("yes-perf"),
      payload: {},
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().status).toBe("confirmed");

    // Applied HERE, not left for the operator to re-save — otherwise there is a
    // window in which everyone has agreed and the event still says the old date.
    expect((await eventRow(event.id))?.eventDate).toBe("2026-09-19");

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("yes-perf"),
    });
    expect(after.json().request).toBeNull();
  });

  /**
   * MOVING THE NIGHT RANG ONE BELL, AND IT BELONGED TO THE PERSON WHO ASKED
   * (QA sweep run 6, QA6-2).
   *
   * Changing the capacity on the same event notified five people; moving the date
   * notified the proposer. The negotiated fields are stripped out of the ordinary
   * PATCH and applied by `answerChangeRequest`, so they never reached the
   * `eventChangeNotice` call that tells the bill about an edit, and the only
   * notifier on this path was `notifyProposer`.
   */
  it("tells the rest of the bill the night moved, and nobody twice", async () => {
    const { event, operator } = await bookedEvent("bill");
    // A third party who neither proposed nor answered: the crew member whose call
    // time depends on the date and who has no vote on it.
    const crew = await seedMemberWithSet(
      "bill-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
    });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      // ACTING AS THE OPERATOR'S PROFILE, which is what the app always sends and
      // what puts `proposedByProfileId` on the row. Without it the proposal has no
      // proposer profile, `notifyProposer` sends nothing, and there is no duplicate
      // for this rule to avoid — so the header is what makes the test test it.
      headers: { ...auth("bill-op"), "x-profile-id": operator.profileId },
      payload: { eventDate: "2026-09-19" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("bill-perf"),
      })
    ).json().request.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/confirm`,
      headers: auth("bill-perf"),
      payload: {},
    });

    const notices = await harness.db
      .select({
        userId: schema.notifications.userId,
        type: schema.notifications.type,
        title: schema.notifications.title,
        body: schema.notifications.body,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventId, event.id));

    // THE CREW MEMBER'S BELL, which is the whole of this finding.
    const applied = notices.filter((row) => row.type === "event.updated");
    expect(applied.map((row) => row.userId)).toEqual(["bill-crew"]);
    // Names the field, never its value — the same rule the ordinary edit follows.
    expect(applied[0]?.body).toBe("The date changed.");
    expect(applied[0]?.title).toBe('"Roster Night" was updated');

    // The PROPOSER keeps their own, better message and does not also get this one:
    // "the date moved, everyone agreed" already says more than "the date changed".
    const proposerTypes = notices.filter((row) => row.userId === "bill-op").map((row) => row.type);
    expect(proposerTypes).toContain("event.change_confirmed");
    expect(proposerTypes).not.toContain("event.updated");

    // And the party who just answered gets no notice of their own answer — they
    // are the actor, and `eventParticipantRecipients` drops them, exactly as the
    // ordinary edit drops whoever pressed save. (They still hold the earlier
    // notices about being added and about the proposal, which is why this asserts
    // the TYPE rather than an empty list.)
    expect(
      notices.filter((row) => row.userId === "bill-perf" && row.type === "event.updated"),
    ).toHaveLength(0);
  });

  it("says nothing to the bill when the change was declined", async () => {
    // Nothing was applied, so there is nothing to announce to people who never saw
    // the proposal; the proposer's own notice carries the no.
    const { event } = await bookedEvent("nobill");
    const crew = await seedMemberWithSet(
      "nobill-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("nobill-op"),
      payload: { eventDate: "2026-09-19" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("nobill-perf"),
      })
    ).json().request.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/decline`,
      headers: auth("nobill-perf"),
      payload: { note: "We are on tour that week" },
    });

    const notices = await harness.db
      .select({ userId: schema.notifications.userId, type: schema.notifications.type })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventId, event.id));
    expect(notices.filter((row) => row.type === "event.updated")).toHaveLength(0);
    expect(notices.filter((row) => row.userId === "nobill-crew")).toHaveLength(0);
  });

  it("leaves the night alone when the act declines, and keeps the reason", async () => {
    const { db } = harness;
    const { event } = await bookedEvent("no");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("no-op"),
      payload: { eventDate: "2026-09-19" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("no-perf"),
      })
    ).json().request.id;

    const answered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/decline`,
      headers: auth("no-perf"),
      payload: { note: "We fly out that morning" },
    });
    expect(answered.json().status).toBe("declined");
    expect((await eventRow(event.id))?.eventDate).toBe("2026-09-12");

    // SCOPED TO THIS EVENT. It was filtered on the type alone, which passed only
    // while this was the suite's one declined change — a second declining test
    // elsewhere in the file made it read somebody else's note (measured while
    // adding one). A query that can answer with another test's row is not an
    // assertion about this one.
    const [activity] = await db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.type, "event.change_declined"),
          eq(schema.activityLog.eventId, event.id),
        ),
      );
    expect((activity?.summary as { note?: string } | null)?.note).toBe("We fly out that morning");
  });

  it("refuses to let the proposer answer their own proposal", async () => {
    const { event } = await bookedEvent("self");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("self-op"),
      payload: { eventDate: "2026-09-19" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("self-perf"),
      })
    ).json().request.id;

    // Otherwise the whole mechanism is decorative: the operator could raise a
    // proposal and immediately wave it through.
    const own = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/confirm`,
      headers: auth("self-op"),
      payload: {},
    });
    expect(own.statusCode).toBe(403);
    expect((await eventRow(event.id))?.eventDate).toBe("2026-09-12");
  });

  /**
   * RUNG 1 ON THE TWO PATHS A PERSON CAN ACTUALLY TAKE (ClickUp `86cbcehmp`).
   *
   * Ran's step 1 is *"inviting performers from the system in the flow or from the event
   * manager should move the event from draft to suggested"*. The rung existed and fired
   * from `POST /events/:id/participants` alone — a route `apps/web` never calls. The
   * wizard writes its bill inside `POST /events`, and Invite Collaborator posts
   * `/invitations`, so on both real paths the night stayed `draft` until somebody
   * accepted, and then jumped to `pending`. `suggested` never happened.
   */
  it("puts the act's own genres on the roster row", async () => {
    /**
     * ClickUp `86cbcf6gr`: the genres are on the profile and were not on the event, so
     * the one screen where an act is being booked could not say what kind of act it is.
     * They travel with the roster — read from the profile, never copied onto the
     * booking, because a genre is the performer's word about themselves.
     */
    const seeded = await seedEventWithHost("genres");
    await harness.db
      .update(schema.profiles)
      .set({ details: { genres: ["Nordic folk", "Ambient"], tagline: "ignored here" } })
      .where(eq(schema.profiles.id, seeded.performer.profileId));
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.event.id}/participants`,
      headers: auth("genres-op"),
      payload: { profileId: seeded.performer.profileId, role: "performer" },
    });

    const roster = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.event.id}/participants`,
      headers: auth("genres-op"),
    });
    expect(roster.statusCode).toBe(200);
    const act = roster
      .json()
      .find((party: { profileId: string }) => party.profileId === seeded.performer.profileId);
    expect(act.genres).toEqual(["Nordic folk", "Ambient"]);
    // The host named none, and none is an empty list rather than a missing field —
    // every row answers the question the same way.
    const host = roster
      .json()
      .find((party: { profileId: string }) => party.profileId === seeded.operator.profileId);
    expect(host.genres).toEqual([]);
  });

  it("moves a draft to suggested when the wizard names an act on it", async () => {
    const operator = await seedMemberWithSet(
      "wizrung-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "wizrung-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("wizrung-op"), "x-profile-id": operator.profileId },
      payload: {
        title: "Wizard Night",
        baseCurrency: "SEK",
        participants: [{ profileId: performer.profileId, role: "performer" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect((await eventRow(created.json().id))?.status).toBe("suggested");
    // The negative belongs to the OTHER path, not this one: the wizard's own body
    // accepts `performer` and `support` and nothing else (`CreateEventParticipant`), so
    // a crew member cannot be named here at all. `invitations.test.ts` covers a
    // co-operator invite leaving a draft where it is.
  });

  /**
   * RENAMING SOMEBODY ELSE'S SHOW IS ALLOWED AND MUST NOT BE SILENT.
   *
   * The title is deliberately not a negotiated field — `NEGOTIATED_FIELDS` is the date,
   * the venue and the room, because those are what a party agreed to, and a confirm
   * step in front of a rename would make the mechanism hated rather than respected. But
   * the title is the one identifying fact of the night: it is on the performers'
   * screens, the public page and every notification. A co-host renamed the seeded show
   * and the host learned nothing until they happened to reload (QA sweep, 2026-09-27).
   */
  it("tells the host when a co-operator renames their show, and says nothing when they rename it themselves", async () => {
    const { db } = harness;
    const seeded = await seedEventWithHost("rename");
    const coHost = await seedMemberWithSet(
      "rename-co",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    /**
     * A SECOND MEMBER OF THE HOST PROFILE — and the reason this test needs one.
     *
     * `notifyProfileMembers` already skips the actor ("you never notify yourself"), so
     * a host profile with one member is told nothing about its own rename however the
     * route is written. Asserting on THAT member would pass with the guard removed,
     * which is a test incapable of failing on the thing it names. Their colleague is
     * the one who proves it: without the guard, the host's own team gets a
     * notification that somebody renamed their show, naming them.
     */
    await db
      .insert(schema.users)
      .values({ id: "rename-op2", email: "rename-op2@example.showme.test", kind: "operator" });
    await db.insert(schema.profileMembers).values({
      profileId: seeded.operator.profileId,
      userId: "rename-op2",
      role: "admin",
      status: "active",
    });
    await db.insert(schema.eventParticipants).values({
      eventId: seeded.event.id,
      profileId: coHost.profileId,
      role: "co_host",
      permissionSetId: coHost.permissionSetId,
      status: "confirmed",
    });

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.event.id}`,
      headers: { ...auth("rename-co"), "x-profile-id": coHost.profileId },
      payload: { title: "Co-host renamed this" },
    });
    // Allowed: a co-operator may rename the night they are co-promoting.
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().title).toBe("Co-host renamed this");

    const toHost = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "rename-op"));
    expect(toHost).toHaveLength(1);
    // `event.updated` rather than a rename-specific type since `86cbcftg3`: ONE notice
    // per save, naming whatever moved, to everyone on the bill. The rename-only notice
    // it replaces reached the host profile alone, so a performer whose show was renamed
    // was never told — and a door time moving told nobody at all.
    expect(toHost[0]?.type).toBe("event.updated");
    expect(toHost[0]?.title).toBe('"Roster Night" was renamed');
    expect(toHost[0]?.body).toBe('The name changed. It is now "Co-host renamed this".');

    // Their colleague hears about it too — it is their profile's show.
    const toColleague = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "rename-op2"));
    expect(toColleague).toHaveLength(1);

    /**
     * THE AUDIENCE CHANGED WITH `86cbcftg3`, and this is the assertion that used to say
     * the opposite.
     *
     * It read: *"The host profile renaming its OWN show tells its own people nothing: it
     * is not news to them, and a notification about your own side's act is the fastest
     * way to teach people to ignore the bell."* That was the rename-only notice's rule,
     * and it was addressed to a PROFILE.
     *
     * The notice is now "what changed", addressed to everyone standing on the event minus
     * the person who did it — the same audience as the cancellation and the publication
     * notices built the same day. So a colleague of the acting profile DOES hear, and the
     * three notices behave alike rather than each having its own idea of who counts.
     *
     * The noise argument has not gone away; it has moved to where a user can act on it.
     * `notification_preferences` already carries an `events` switch, and a preference is
     * the right home for "I do not want these" — better than an audience rule nobody can
     * see or change.
     */
    const byHost = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.event.id}`,
      headers: { ...auth("rename-op"), "x-profile-id": seeded.operator.profileId },
      payload: { title: "Back to the host's name" },
    });
    expect(byHost.statusCode).toBe(200);
    const colleagueAfter = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "rename-op2"));
    expect(colleagueAfter).toHaveLength(2);
    expect(colleagueAfter[1]?.body).toBe('The name changed. It is now "Back to the host\'s name".');
    // And never the actor themselves, whichever side they are on.
    expect(
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, "rename-op")),
    ).toHaveLength(1);
  });

  it("replaces an open proposal rather than stacking a second one", async () => {
    const { event } = await bookedEvent("twice2");
    for (const date of ["2026-09-19", "2026-09-26"]) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${event.id}`,
        headers: auth("twice2-op"),
        payload: { eventDate: date },
      });
    }

    // An operator who changes their mind has asked one question, not two — the
    // act must never face two live proposals for the same night.
    const open = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("twice2-perf"),
      })
    ).json().request;
    expect(open.changes).toEqual({ eventDate: "2026-09-26" });

    const rows = await harness.db
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.eventId, event.id));
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "superseded")).toHaveLength(1);
  });

  it("writes the negotiation into the event conversation, both halves", async () => {
    const { db } = harness;
    const { event } = await bookedEvent("thread");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("thread-op"),
      payload: { eventDate: "2026-09-19" },
    });

    const bodies = async () =>
      (
        await db
          .select({ body: schema.eventMessages.body, visibility: schema.eventMessages.visibility })
          .from(schema.eventMessages)
          .where(eq(schema.eventMessages.eventId, event.id))
      ).map((row) => row.body);

    /*
     * The ASK is in the thread, with both values — a conversation that only records the outcome
     * reads "can we move it?" / "sure" six months later.
     *
     * IN THE READER'S DATE SHAPE, and these assertions used to pin the stored one. A change notice
     * is prose a person reads in the event room, so `2026-09-12` was the same defect QA sweep run 13
     * reported on a notification, held in place here by a passing test
     * (`@showme/shared::formatCalendarDay`).
     */
    expect(await bodies()).toEqual([
      "Asked to change the date from 12 Sep 2026 to 19 Sep 2026. Waiting on the other side to confirm.",
    ]);

    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("thread-perf"),
      })
    ).json().request.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/decline`,
      headers: auth("thread-perf"),
      payload: { note: "We fly out that morning" },
    });

    // And the ANSWER, carrying the reason.
    expect(await bodies()).toEqual([
      "Asked to change the date from 12 Sep 2026 to 19 Sep 2026. Waiting on the other side to confirm.",
      "Declined the change to the date from 12 Sep 2026 to 19 Sep 2026. Reason: We fly out that morning",
    ]);
    // No stored date shape survives into either half.
    for (const body of await bodies()) expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // The event room, not a private thread: a night moving is not a matter
    // between two parties — the crew's call time depends on it.
    const rows = await db
      .select({
        visibility: schema.eventMessages.visibility,
        threadParticipantId: schema.eventMessages.threadParticipantId,
      })
      .from(schema.eventMessages)
      .where(eq(schema.eventMessages.eventId, event.id));
    expect(rows.every((row) => row.visibility === "all")).toBe(true);
    expect(rows.every((row) => row.threadParticipantId === null)).toBe(true);
  });

  it("asks the AGENT, not the performer they represent", async () => {
    const { db } = harness;
    const { performer, event } = await bookedEvent("delegated");

    // Stand the performer's participation down in favour of an agent, exactly as
    // `autoAssignAgentOnPerformerJoin` does when a represented act is added.
    const agent = await seedMemberWithSet("delegated-agent", "operator", [
      ...PRESET_PERMISSION_SETS.operator_full,
    ]);
    const [rep] = await db
      .insert(schema.representations)
      .values({
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        status: "active",
        region: ["SE"],
        proposedBy: "agent",
      })
      .returning();
    expect(rep).toBeTruthy();
    await db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: agent.profileId,
      role: "agent",
      status: "accepted",
    });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("delegated-op"),
      payload: { eventDate: "2026-09-19" },
    });

    // ONE answer, not two. Counting both would demand two confirmations for one
    // party's interest — from a performer who has handed the action capabilities
    // to that very agent (decisions #14).
    const open = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("delegated-agent"),
      })
    ).json().request;
    expect(open.required).toBe(1);
    expect(open.answerable).toBe(true);

    const answered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${open.id}/confirm`,
      headers: auth("delegated-agent"),
      payload: {},
    });
    expect(answered.json().status).toBe("confirmed");
    expect((await eventRow(event.id))?.eventDate).toBe("2026-09-19");
  });

  it("does not ask anybody about a title, or about a date that did not move", async () => {
    const { event } = await bookedEvent("quiet");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("quiet-op"),
      // The web app saves the whole form: the date arrives unchanged every time.
      payload: { title: "Just a rename", eventDate: "2026-09-12" },
    });

    const open = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("quiet-perf"),
    });
    expect(open.json().request).toBeNull();
  });
});

/**
 * ── LOOKED AT FROM EVERY SIDE, NOT JUST THE OPERATOR'S (86cbcehmp) ─────────
 *
 * Ran, on reviewing the first version: *"you only look from the operator side.
 * You need to look from all sides."* Driving the same features as the act, the
 * agent and the crew found three things the operator's view could never show.
 * These are those three, so they cannot come back.
 */
describe("participants — every side of an invitation", () => {
  /** An act represented by an agent, invited to the operator's event. */
  async function bookedThroughAnAgent(prefix: string) {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost(prefix);
    const agent = await seedMemberWithSet(`${prefix}-agent`, "agent", [
      ...PRESET_PERMISSION_SETS.operator_full,
    ]);
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: performer.profileId,
      status: "active",
      // Worldwide so the territory check passes without a venue location — the
      // territory rule has its own tests; this fixture is about delegation.
      isWorldwide: true,
      proposedBy: "agent",
    });

    // THROUGH THE REAL ROUTE, so `autoAssignAgentOnPerformerJoin` runs and writes
    // the delegation and the agent row ITSELF. Hand-seeding those two was the
    // first version of this fixture, and it made the "agent is not auto-accepted"
    // test assert its own setup — it stayed green with the bug put back.
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth(`${prefix}-op`),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    return { operator, performer, agent, event };
  }

  const invitations = (uid: string) =>
    app.inject({ method: "GET", url: "/api/v1/me/event-invitations", headers: auth(uid) }).then(
      (response) =>
        response.json() as Array<{
          eventId: string;
          answerableByYou: boolean;
          delegateName: string | null;
        }>,
    );

  /**
   * READ-ONLY IS NOT ABSENT (decisions §25.7.3, and QA sweep run 11 found the difference).
   *
   * This test's own stated reason has always been *"the act's screens are read-only on it"* and
   * its assertion was that the act cannot see the event at all — the two are not the same, and
   * Daniel's ruling chose the first: *"the act SEES; the ACTIONS stay with the agent."* It was
   * already implemented that way for booking requests, where Marlo's Outgoing tab shows the
   * offer Astra sent marked "via Astra Booking"; event invitations were the other surface.
   *
   * What the NAME says is unchanged and still asserted: the answer is the agent's.
   */
  it("sends a represented act's invitation to their AGENT, and lets the act SEE it", async () => {
    const { event } = await bookedThroughAnAgent("side-a");

    const agentRow = (await invitations("side-a-agent")).find((one) => one.eventId === event.id);
    expect(agentRow?.answerableByYou).toBe(true);
    // …and names the act it is answering for, which the card never said.
    expect(agentRow?.delegateName).toBe("side-a-perf");

    const actRow = (await invitations("side-a-perf")).find((one) => one.eventId === event.id);
    expect(actRow, "the act can see the night it was booked onto").toBeDefined();
    expect(actRow?.answerableByYou).toBe(false);
    expect(actRow?.delegateName).toBe("side-a-agent");
  });

  it("leaves an UNrepresented act answering for themselves, with nobody named", async () => {
    // The control: the same list, the same route, and no delegation in it. Without this the
    // assertions above would pass over a list that had simply stopped filtering anything.
    const { event, performer } = await seedEventWithHost("side-solo");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("side-solo-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const row = (await invitations("side-solo-perf")).find((one) => one.eventId === event.id);
    expect(row?.answerableByYou).toBe(true);
    expect(row?.delegateName).toBeNull();
  });

  it("lets the agent answer, and moves their own row with it", async () => {
    const { db } = harness;
    const { agent, performer, event } = await bookedThroughAnAgent("side-b");

    const answered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("side-b-agent"),
      payload: {},
    });
    expect(answered.statusCode).toBe(200);

    const rows = await db
      .select({
        profileId: schema.eventParticipants.profileId,
        status: schema.eventParticipants.status,
      })
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    const act = rows.find((row) => row.profileId === performer.profileId);
    const theAgent = rows.find((row) => row.profileId === agent.profileId);

    // Both move. An agent left at `invited` would be locked out of the booking
    // they had just agreed to.
    expect(act?.status).toBe("accepted");
    expect(theAgent?.status).toBe("accepted");
  });

  it("does not stand the agent on an event nobody has agreed to play", async () => {
    const { db } = harness;
    const { agent, event } = await bookedThroughAnAgent("side-c");
    const [row] = await db
      .select({ status: schema.eventParticipants.status })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, agent.profileId),
        ),
      );
    // An agent participation is the PROJECTION of a representation. It cannot be
    // further along than the act it projects — this used to be `accepted` while
    // the act sat unanswered.
    expect(row?.status).toBe("invited");
  });

  it("still lets an UNrepresented act answer for themselves", async () => {
    const { performer, event } = await seedEventWithHost("side-d");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("side-d-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    // The guard that stops the delegation rule swallowing the ordinary case.
    expect((await invitations("side-d-perf")).map((one) => one.eventId)).toContain(event.id);
    const answered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participation/accept`,
      headers: auth("side-d-perf"),
      payload: {},
    });
    expect(answered.statusCode).toBe(200);
  });
});

/**
 * ── THE ACT CAN ASK TOO (86cbcftg3, after Ran's "all sides" review) ────────
 *
 * The first version let only the operator ask to move a night. Driven as each
 * kind, the performer, the agent and the crew all got a flat 403 — so an act who
 * had to move a booking had no path in the product at all.
 */
describe("events — asking to move a night, from the act's side", () => {
  async function bookedEvent(prefix: string) {
    const seeded = await seedEventWithHost(prefix);
    await harness.db
      .update(schema.events)
      .set({ eventDate: "2026-09-12" })
      .where(eq(schema.events.id, seeded.event.id));
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.event.id}/participants`,
      headers: auth(`${prefix}-op`),
      payload: { profileId: seeded.performer.profileId, role: "performer" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.event.id}/participation/accept`,
      headers: auth(`${prefix}-perf`),
      payload: {},
    });
    return seeded;
  }

  const dateOf = async (eventId: string) => {
    const [row] = await harness.db
      .select({ eventDate: schema.events.eventDate })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    return row?.eventDate;
  };

  it("lets the performer ask, and the operator answers", async () => {
    const { event } = await bookedEvent("ask-perf");

    const asked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("ask-perf-perf"),
      payload: { eventDate: "2026-10-03", reason: "We fly out that morning" },
    });
    expect(asked.statusCode).toBe(200);

    // Nothing moves until the other side agrees — same as the operator's ask.
    expect(await dateOf(event.id)).toBe("2026-09-12");

    // And it is the OPERATOR who is now being asked.
    const forOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("ask-perf-op"),
    });
    expect(forOperator.json().request).toMatchObject({
      changes: { eventDate: "2026-10-03" },
      reason: "We fly out that morning",
      answerable: true,
    });

    // The asker cannot wave their own request through.
    const own = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${forOperator.json().request.id}/confirm`,
      headers: auth("ask-perf-perf"),
      payload: {},
    });
    expect(own.statusCode).toBe(403);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${forOperator.json().request.id}/confirm`,
      headers: auth("ask-perf-op"),
      payload: {},
    });
    expect(confirmed.json().status).toBe("confirmed");
    expect(await dateOf(event.id)).toBe("2026-10-03");
  });

  /**
   * CREW HAVE NO VOTE ON THE NIGHT — Ran's call, 2026-09-19.
   *
   * Both directions, because a vote is a vote either way: a counterpart who
   * declines blocks a move as surely as a proposer starts one. story.md puts
   * `team_and_crew` at arm's length — a fixed fee, "the schedule and their own
   * deal, never the budget" — so they are told the night is moving and get no
   * say in it.
   */
  async function bookedEventWithCrew(prefix: string) {
    const seeded = await bookedEvent(prefix);
    const crew = await seedMemberWithSet(
      `${prefix}-crew`,
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: seeded.event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
      details: { callTime: "16:00", task: "Front-of-house sound" },
    });
    return { ...seeded, crew };
  }

  it("refuses to let crew ask to move the night", async () => {
    const { event } = await bookedEventWithCrew("crew-ask");

    const asked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("crew-ask-crew"),
      payload: { eventDate: "2026-10-03", reason: "I have another gig" },
    });
    expect(asked.statusCode).toBe(403);
    expect(await dateOf(event.id)).toBe("2026-09-12");
  });

  /**
   * A REFUSAL MUST NOT MISDESCRIBE WHAT THE READER DID (QA sweep run 2, 2026-09-26).
   *
   * Declining somebody else's proposal as crew returned 403 "You proposed this change;
   * somebody else has to answer it". The outcome is right — crew have no vote in either
   * direction — and the sentence is false: they had proposed nothing. The code even
   * carried a comment claiming the message said so. A refusal that names you as the
   * cause sends you hunting for a mistake you did not make.
   */
  it("tells crew the answer is not theirs, without calling them the proposer", async () => {
    const { event } = await bookedEventWithCrew("crew-msg");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("crew-msg-op"),
      payload: { eventDate: "2026-10-03" },
    });
    const crid = (
      await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/change-request`,
        headers: auth("crew-msg-crew"),
      })
    ).json().request.id;

    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/decline`,
      headers: auth("crew-msg-crew"),
      payload: {},
    });
    expect(refused.statusCode).toBe(403);
    const message = refused.json().error.message as string;
    expect(message).not.toContain("You proposed");
    expect(message).toContain("not yours to answer");

    // …and the operator who DID propose it still gets the sentence that is true of them.
    const byProposer = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${crid}/decline`,
      headers: auth("crew-msg-op"),
      payload: {},
    });
    expect(byProposer.statusCode).toBe(403);
    expect(byProposer.json().error.message).toContain("You proposed this change");
  });

  it("does not ask crew to confirm a move, so they cannot veto one", async () => {
    // The half that is easy to miss: leaving crew in the answering set would let
    // a sound engineer block a date the venue and the act had both agreed on.
    const { event } = await bookedEventWithCrew("crew-veto");

    const asked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("crew-veto-op"),
      payload: { eventDate: "2026-10-03" },
    });
    expect(asked.statusCode).toBe(200);

    // Only the act is being waited on — not the act AND the crew member.
    const forCrew = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("crew-veto-crew"),
    });
    // Crew still SEE it — their call time depends on the night.
    expect(forCrew.json().request).toMatchObject({ required: 1, answerable: false });

    // And their decline is not counted.
    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${forCrew.json().request.id}/decline`,
      headers: auth("crew-veto-crew"),
      payload: {},
    });
    expect(declined.statusCode).toBe(403);

    // The act alone settles it.
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request/${forCrew.json().request.id}/confirm`,
      headers: auth("crew-veto-perf"),
      payload: {},
    });
    expect(confirmed.json().status).toBe("confirmed");
    expect(await dateOf(event.id)).toBe("2026-10-03");
  });

  it("does not hand the act `event.edit` on the way", async () => {
    const { event } = await bookedEvent("ask-noedit");
    // Proposing is not editing. An act that could PATCH would come away able to
    // rename the show and rewrite its notes, which is why this is its own route.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ask-noedit-perf"),
      payload: { title: "Renamed by the act" },
    });
    expect(patched.statusCode).toBe(403);
  });

  it("refuses a request that changes nothing, and one on an unagreed booking", async () => {
    const { event } = await bookedEvent("ask-noop");
    const nothing = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/change-request`,
      headers: auth("ask-noop-perf"),
      payload: { eventDate: "2026-09-12" },
    });
    expect(nothing.statusCode).toBe(400);

    // A draft has nobody to negotiate with — and an act cannot be standing on
    // one in the first place.
    const { event: draft, performer } = await seedEventWithHost("ask-draft");
    expect(performer.profileId).toBeTruthy();
    const tooEarly = await app.inject({
      method: "POST",
      url: `/api/v1/events/${draft.id}/change-request`,
      headers: auth("ask-draft-op"),
      payload: { eventDate: "2026-10-03" },
    });
    expect([403, 409]).toContain(tooEarly.statusCode);
  });
});
