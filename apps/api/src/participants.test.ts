import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [participantRoutes]);
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
  kind: "operator" | "performer" | "team_and_crew",
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
