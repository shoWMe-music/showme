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

    const forOperator = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "notify-op"));
    expect(forOperator).toHaveLength(0);
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

    const crew = await seedMemberWithSet("ga-plain-agent", "performer", ["event.view"]);
    const addedAgent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-plain-op"),
      payload: { profileId: crew.profileId, role: "agent", permissionSetId: agentSetId },
    });
    expect(addedAgent.statusCode).toBe(201);
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
describe("participants — an invitation must be answered", () => {
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
    const [activity] = await db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.type, "participant.declined"));
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

    const [activity] = await db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.type, "event.change_declined"));
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

    // The ASK is in the thread, with both values — a conversation that only
    // records the outcome reads "can we move it?" / "sure" six months later.
    expect(await bodies()).toEqual([
      "Asked to change the date from 2026-09-12 to 2026-09-19. Waiting on the other side to confirm.",
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
      "Asked to change the date from 2026-09-12 to 2026-09-19. Waiting on the other side to confirm.",
      "Declined the change to the date from 2026-09-12 to 2026-09-19. Reason: We fly out that morning",
    ]);

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
    app
      .inject({ method: "GET", url: "/api/v1/me/event-invitations", headers: auth(uid) })
      .then((response) => response.json() as Array<{ eventId: string }>);

  it("sends a represented act's invitation to their AGENT, not to the act", async () => {
    const { event } = await bookedThroughAnAgent("side-a");
    // The agent negotiates and confirms; the act's screens are read-only on it
    // (decisions #14). This was exactly backwards before.
    expect((await invitations("side-a-agent")).map((one) => one.eventId)).toContain(event.id);
    expect((await invitations("side-a-perf")).map((one) => one.eventId)).not.toContain(event.id);
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
