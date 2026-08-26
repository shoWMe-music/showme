import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { invitationRoutes } from "./routes/invitations";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [invitationRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** A bare provisioned user (no memberships). */
async function seedUser(id: string, kind: "operator" | "performer") {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/** Seed an owner + their profile + a permission set. Returns the ids. */
async function seedOwnerWithProfile(id: string) {
  const { db } = harness;
  await seedUser(id, "operator");
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id, claimedAt: new Date() })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({
      profileId: profile.id,
      name: "operator_full",
      capabilities: [...PRESET_PERMISSION_SETS.operator_full],
    })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { profileId: profile.id, permissionSetId: set.id };
}

describe("invitations — create, redeem, decline", () => {
  it("owner creates a SHOW-code profile_member invite; recipient reads + accepts it", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("inv-owner");
    await seedUser("inv-recipient", "performer");

    // Create — as the profile owner, a code invite granting editor membership.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-owner"), "x-profile-id": owner.profileId },
      payload: {
        type: "code",
        source: "collaborator",
        recipientEmail: "inv-recipient@example.com",
        recipientName: "Rae Recipient",
        targetProfileId: owner.profileId,
        role: "editor",
        permissionSetId: owner.permissionSetId,
      },
    });
    expect(created.statusCode).toBe(201);
    const code = created.json().code as string;
    expect(code).toMatch(/^SHOW-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.json().token).toBeNull();
    expect(created.json().status).toBe("pending");

    const createAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "invitation.create"));
    expect(createAudit).toHaveLength(1);

    // Recipient reads the invite by its human code.
    const summary = await app.inject({
      method: "GET",
      url: `/api/v1/invitations/${code}`,
      headers: auth("inv-recipient"),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      type: "code",
      status: "pending",
      targetProfileId: owner.profileId,
      role: "editor",
    });

    // Recipient accepts → a profile membership now exists + invite is accepted.
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${code}/accept`,
      headers: auth("inv-recipient"),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("accepted");

    const membership = await db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, owner.profileId),
          eq(schema.profileMembers.userId, "inv-recipient"),
        ),
      );
    expect(membership).toHaveLength(1);
    expect(membership[0]?.role).toBe("editor");
    expect(membership[0]?.status).toBe("active");

    const acceptAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "invitation.accept"));
    expect(acceptAudit).toHaveLength(1);
    expect(acceptAudit[0]?.actorUserId).toBe("inv-recipient");

    // Accepting again → 409 (the invite is no longer pending).
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${code}/accept`,
      headers: auth("inv-recipient"),
    });
    expect(again.statusCode).toBe(409);
  });

  it("409s an accept that would duplicate an existing membership", async () => {
    const owner = await seedOwnerWithProfile("dup-owner");
    await seedUser("dup-recipient", "performer");
    // Already a member of the profile.
    await harness.db.insert(schema.profileMembers).values({
      profileId: owner.profileId,
      userId: "dup-recipient",
      role: "viewer",
      status: "active",
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("dup-owner"), "x-profile-id": owner.profileId },
      payload: {
        type: "code",
        source: "collaborator",
        targetProfileId: owner.profileId,
        role: "editor",
      },
    });
    const code = created.json().code as string;

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${code}/accept`,
      headers: auth("dup-recipient"),
    });
    expect(accepted.statusCode).toBe(409);
  });

  it("forbids a non-owner member from creating an invite for the profile (403)", async () => {
    const owner = await seedOwnerWithProfile("perm-owner");
    // An editor member — a member, but not owner/admin.
    await seedUser("perm-editor", "operator");
    await harness.db.insert(schema.profileMembers).values({
      profileId: owner.profileId,
      userId: "perm-editor",
      role: "editor",
      status: "active",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("perm-editor"), "x-profile-id": owner.profileId },
      payload: { type: "code", source: "collaborator", targetProfileId: owner.profileId },
    });
    expect(response.statusCode).toBe(403);
  });

  it("declines an invite (status → declined) + audits", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("dec-owner");
    await seedUser("dec-recipient", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("dec-owner"), "x-profile-id": owner.profileId },
      payload: {
        type: "code",
        source: "collaborator",
        targetProfileId: owner.profileId,
        role: "editor",
      },
    });
    const code = created.json().code as string;

    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${code}/decline`,
      headers: auth("dec-recipient"),
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().status).toBe("declined");

    const invite = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.code, code));
    expect(invite[0]?.status).toBe("declined");

    const declineAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "invitation.decline"));
    expect(declineAudit).toHaveLength(1);

    // A declined invite cannot then be accepted.
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${code}/accept`,
      headers: auth("dec-recipient"),
    });
    expect(accept.statusCode).toBe(409);
  });

  it("404s an unknown token and mints an opaque token for non-code invites", async () => {
    const owner = await seedOwnerWithProfile("tok-owner");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("tok-owner"), "x-profile-id": owner.profileId },
      payload: {
        type: "profile_member",
        source: "team",
        targetProfileId: owner.profileId,
        role: "viewer",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().code).toBeNull();
    expect(created.json().token).toMatch(/^[0-9a-f]{48}$/);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/does-not-exist",
      headers: auth("tok-owner"),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("claims an unclaimed stub profile and grants owner membership", async () => {
    const { db } = harness;
    // Bootstrap: a real operator who creates the stub + the invite.
    const host = await seedOwnerWithProfile("claim-host");
    await seedUser("claim-user", "performer");

    // An unclaimed stub profile (claimedAt NULL), owned for now by the host.
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "claim-host",
        name: "Stub Act",
        slug: "stub-act",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");

    // The invite links the stub. Created directly (its own authorize path is the
    // host's control of the stub); we exercise the claim endpoint here.
    const [invite] = await db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "performer_offer",
        status: "pending",
        token: "claim-token-abc",
        targetProfileId: stub.id,
        role: "owner",
        createdByUser: "claim-host",
      })
      .returning();
    if (!invite) throw new Error("invite seed failed");

    const claimed = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/claim-token-abc/claim",
      headers: auth("claim-user"),
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().status).toBe("used");

    const [after] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, stub.id));
    expect(after?.ownerUserId).toBe("claim-user");
    expect(after?.claimedAt).not.toBeNull();

    const ownerMembership = await db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, stub.id),
          eq(schema.profileMembers.userId, "claim-user"),
        ),
      );
    expect(ownerMembership).toHaveLength(1);
    expect(ownerMembership[0]?.role).toBe("owner");

    const claimAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "invitation.claim"));
    expect(claimAudit).toHaveLength(1);

    // host is referenced to keep the seed meaningful (silences unused lint).
    expect(host.profileId).toBeTruthy();
  });
});

describe("invitations — the grant_admin entitlement gate (paid plans only)", () => {
  /** An operator host with an event they may manage participants on. */
  async function seedEventHost(prefix: string) {
    const { db } = harness;
    const host = await seedOwnerWithProfile(`${prefix}-host`);
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Invited Night",
        baseCurrency: "SEK",
        createdBy: `${prefix}-host`,
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
    return { host, event };
  }

  /** A performer who can accept an invitation as their own profile. */
  async function seedRecipient(id: string) {
    const { db } = harness;
    await seedUser(id, "performer");
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "performer", ownerUserId: id, name: id, slug: id })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
    return { userId: id, profileId: profile.id };
  }

  it("403s a FREE host inviting a collaborator INTO an admin-grade set, and stores no invitation", async () => {
    const { host, event } = await seedEventHost("inv-ga-free");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-ga-free-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "co@example.com",
        targetEventId: event.id,
        role: "co_host",
        // `seedOwnerWithProfile` mints the operator_full bundle — admin-grade.
        permissionSetId: host.permissionSetId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const rows = await harness.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.targetEventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("lets a PAID host send the same invitation, and the recipient redeems it", async () => {
    const { host, event } = await seedEventHost("inv-ga-paid");
    const recipient = await seedRecipient("inv-ga-paid-rec");
    await harness.db
      .insert(schema.plans)
      .values({ profileId: host.profileId, tier: "operator_pro" });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-ga-paid-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "co@example.com",
        targetEventId: event.id,
        role: "co_host",
        permissionSetId: host.permissionSetId,
      },
    });
    expect(created.statusCode).toBe(201);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${created.json().token}/accept`,
      headers: { ...auth(recipient.userId), "x-profile-id": recipient.profileId },
    });
    expect(accepted.statusCode).toBe(200);

    const [participant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, recipient.profileId),
        ),
      );
    expect(participant?.permissionSetId).toBe(host.permissionSetId);
  });

  it("403s the ACCEPT when the host's plan lapsed after the invitation was sent", async () => {
    const { db } = harness;
    const { host, event } = await seedEventHost("inv-ga-lapse");
    const recipient = await seedRecipient("inv-ga-lapse-rec");

    // The invitation was minted while the host was paid — write it straight to the
    // table, which is exactly the state a since-lapsed plan leaves behind.
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "event_participant",
        source: "collaborator",
        status: "pending",
        token: "inv-ga-lapse-token",
        recipientEmail: "co@example.com",
        targetEventId: event.id,
        role: "co_host",
        permissionSetId: host.permissionSetId,
        createdByUser: "inv-ga-lapse-host",
      })
      .returning();
    if (!invitation) throw new Error("invitation seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/accept`,
      headers: { ...auth(recipient.userId), "x-profile-id": recipient.profileId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    // Nothing landed: no participant, and the invitation is still redeemable.
    const participants = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, recipient.profileId),
        ),
      );
    expect(participants).toHaveLength(0);
    const [after] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending");
  });

  it("never charges an ordinary performer invitation on a free plan", async () => {
    const { db } = harness;
    const { host, event } = await seedEventHost("inv-ga-plain");
    const recipient = await seedRecipient("inv-ga-plain-rec");
    const [performerSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: host.profileId,
        name: "performer",
        capabilities: [...PRESET_PERMISSION_SETS.performer],
      })
      .returning();
    if (!performerSet) throw new Error("permission set seed failed");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-ga-plain-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "act@example.com",
        targetEventId: event.id,
        role: "performer",
        permissionSetId: performerSet.id,
      },
    });
    expect(created.statusCode).toBe(201);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${created.json().token}/accept`,
      headers: { ...auth(recipient.userId), "x-profile-id": recipient.profileId },
    });
    expect(accepted.statusCode).toBe(200);
  });
});

/**
 * A-37. A-21 closed every EVENT-level path to admin authority; this is the
 * profile-level sibling, which used to walk straight past the gate that
 * `POST /profiles/:id/members` applies to the identical grant — and never
 * consumed a seat when redeemed.
 */
describe("invitations — the PROFILE-level grant_admin gate (A-37)", () => {
  /** A performer who can redeem an invitation as themselves. */
  async function seedInvitee(id: string) {
    await seedUser(id, "performer");
    return { userId: id };
  }

  it("403s a FREE profile inviting someone as admin, and stores no invitation", async () => {
    const owner = await seedOwnerWithProfile("inv-pa-free");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-pa-free"), "x-profile-id": owner.profileId },
      payload: {
        type: "profile_member",
        source: "team",
        recipientEmail: "second@example.com",
        targetProfileId: owner.profileId,
        role: "admin",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const rows = await harness.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.targetProfileId, owner.profileId));
    expect(rows).toHaveLength(0);
  });

  it("lets a PAID profile send it, and the redeemed membership consumes a seat", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("inv-pa-paid");
    const invitee = await seedInvitee("inv-pa-paid-rec");
    await db.insert(schema.plans).values({ profileId: owner.profileId, tier: "operator_pro" });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-pa-paid"), "x-profile-id": owner.profileId },
      payload: {
        type: "profile_member",
        source: "team",
        recipientEmail: "second@example.com",
        targetProfileId: owner.profileId,
        role: "admin",
      },
    });
    expect(created.statusCode).toBe(201);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${created.json().token}/accept`,
      headers: auth(invitee.userId),
    });
    expect(accepted.statusCode).toBe(200);

    const [member] = await db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, owner.profileId),
          eq(schema.profileMembers.userId, invitee.userId),
        ),
      );
    expect(member?.role).toBe("admin");
    // The seat is the point: without this the count is a lie the moment anyone
    // invites an admin rather than adding one directly.
    expect(member?.seatConsumed).toBe(true);
  });

  it("403s the ACCEPT when the profile's plan lapsed after the invitation was sent", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("inv-pa-lapse");
    const invitee = await seedInvitee("inv-pa-lapse-rec");

    // Minted while paid — writing it straight to the table is exactly the state a
    // since-lapsed plan leaves behind.
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "team",
        status: "pending",
        token: "inv-pa-lapse-token",
        recipientEmail: "second@example.com",
        targetProfileId: owner.profileId,
        role: "admin",
        createdByUser: "inv-pa-lapse",
      })
      .returning();
    if (!invitation) throw new Error("invitation seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/accept`,
      headers: auth(invitee.userId),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    // Nothing landed: no membership, and the invitation is still redeemable.
    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, owner.profileId),
          eq(schema.profileMembers.userId, invitee.userId),
        ),
      );
    expect(members).toHaveLength(0);
    const [after] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending");
  });

  it("never charges an ordinary team invitation on a free plan, and takes no seat", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("inv-pa-plain");
    const invitee = await seedInvitee("inv-pa-plain-rec");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-pa-plain"), "x-profile-id": owner.profileId },
      payload: {
        type: "profile_member",
        source: "team",
        recipientEmail: "helper@example.com",
        targetProfileId: owner.profileId,
        role: "editor",
      },
    });
    expect(created.statusCode).toBe(201);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${created.json().token}/accept`,
      headers: auth(invitee.userId),
    });
    expect(accepted.statusCode).toBe(200);

    const [member] = await db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, owner.profileId),
          eq(schema.profileMembers.userId, invitee.userId),
        ),
      );
    expect(member?.role).toBe("editor");
    expect(member?.seatConsumed).toBe(false);
  });
});

/**
 * An invitation is audited either way; only an EVENT invitation is history. The
 * profile-level sibling has no event to have a history, and a row with a null
 * `event_id` is unreachable from every feed — so it is deliberately not written.
 */
describe("invitations — what reaches an event's history", () => {
  async function seedOwner(id: string) {
    const { db } = harness;
    await seedUser(id, "operator");
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "operator", ownerUserId: id, name: id, slug: id, claimedAt: new Date() })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
    // Two sets: the host's own operator bundle (which carries
    // `participants.manage`, so they may invite at all) and the view-only bundle
    // the invitee is granted — an admin-grade grant would trip the paid-plan gate.
    const [operatorSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: profile.id,
        name: "operator_full",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    const [performerSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: profile.id,
        name: "performer",
        capabilities: [...PRESET_PERMISSION_SETS.performer],
      })
      .returning();
    if (!operatorSet || !performerSet) throw new Error("permission set seed failed");
    return {
      profileId: profile.id,
      permissionSetId: operatorSet.id,
      granteeSetId: performerSet.id,
    };
  }

  it("writes activity for an EVENT invite and its acceptance, and none for a PROFILE invite", async () => {
    const { db } = harness;
    const host = await seedOwner("inv-act-host");
    await seedUser("inv-act-rec", "performer");
    const [recipientProfile] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "inv-act-rec",
        name: "inv-act-rec",
        slug: "inv-act-rec",
      })
      .returning();
    if (!recipientProfile) throw new Error("profile seed failed");
    await db.insert(schema.profileMembers).values({
      profileId: recipientProfile.id,
      userId: "inv-act-rec",
      role: "owner",
      status: "active",
    });

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Invite History",
        baseCurrency: "SEK",
        createdBy: "inv-act-host",
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

    const invited = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-act-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "inv-act-rec@example.com",
        recipientName: "Ada Act",
        targetEventId: event.id,
        role: "performer",
        permissionSetId: host.granteeSetId,
      },
    });
    expect(invited.statusCode).toBe(201);
    const token = invited.json().token as string;

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      headers: { ...auth("inv-act-rec"), "x-profile-id": recipientProfile.id },
    });
    expect(accepted.statusCode).toBe(200);

    const rows = await db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, event.id));
    expect(rows.map((row) => row.type).sort()).toEqual(["invitation.accepted", "invitation.sent"]);
    // Both sit at the event-level `invitation` tier, and neither carries the
    // recipient's email address.
    expect(rows.every((row) => row.targetKind === "invitation")).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.summary))).not.toContain("@example.com");
    // The acceptance is recorded against the person who accepted, not the inviter.
    expect(rows.find((row) => row.type === "invitation.accepted")?.actorUserId).toBe("inv-act-rec");

    // A PROFILE invite to the same account writes an audit row and no activity.
    const profileInvite = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("inv-act-host"), "x-profile-id": host.profileId },
      payload: {
        type: "profile_member",
        source: "collaborator",
        recipientEmail: "someone-else@example.com",
        targetProfileId: host.profileId,
        role: "editor",
      },
    });
    expect(profileInvite.statusCode).toBe(201);
    const eventless = await db
      .select()
      .from(schema.activityLog)
      .where(isNull(schema.activityLog.eventId));
    expect(eventless).toHaveLength(0);
  });
});
