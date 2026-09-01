import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { EmailMessage } from "@showme/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { COLLABORATION_INVITE_CREDITS, collaborationCreditBalance } from "./lib/entitlements";
import { invitationRoutes } from "./routes/invitations";
import { buildTestApp } from "./testing";

/**
 * Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`.
 * The identity carries a VERIFIED `<uid>@example.showme.test`, because the redemption
 * routes now read both halves — an invitation is redeemable only by the address
 * it names, and only once Firebase says that address is really theirs. Tests
 * that need the other side of that rule override the identity per-request
 * (`unverifiedVerifier` below) or simply redeem as the wrong uid.
 */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, emailVerified: true, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

/**
 * Every email the shared app sends. Needed since the claim flow stopped being
 * "sign in as the invited address" and became "prove that address with a code":
 * the code exists only in the message, by design — it is stored salted-hashed —
 * so a test that claims has to read it the way a person would.
 */
const sentFromApp: EmailMessage[] = [];

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp(
    {
      database: harness.db,
      tokenVerifier: fakeVerifier,
      emailSink: {
        async sendEmail(message) {
          sentFromApp.push(message);
        },
      },
    },
    [invitationRoutes],
  );
  await app.ready();
});

/**
 * Ask for a claim code and read it out of the email, exactly as the recipient
 * would. Returns the six digits.
 */
async function requestClaimCode(token: string, uid: string): Promise<string> {
  const before = sentFromApp.length;
  const issued = await app.inject({
    method: "POST",
    url: `/api/v1/invitations/${token}/claim-otp`,
    headers: auth(uid),
  });
  if (issued.statusCode !== 200) {
    throw new Error(`claim-otp failed: ${issued.statusCode} ${issued.body}`);
  }
  const message = sentFromApp.slice(before).at(-1);
  const code = message?.text?.match(/\b\d{6}\b/)?.[0] ?? message?.html?.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error("no claim code in the email");
  return code;
}

/** Claim, doing the two steps the route now requires. */
async function claimWith(token: string, uid: string) {
  const otp = await requestClaimCode(token, uid);
  return app.inject({
    method: "POST",
    url: `/api/v1/invitations/${token}/claim`,
    headers: auth(uid),
    payload: { otp },
  });
}

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** A bare provisioned user (no memberships). The display name matters now: the
 * offer a link-holder reads names who invited them, and it reads it off here. */
async function seedUser(id: string, kind: "operator" | "performer") {
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, name: id, kind });
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
        recipientEmail: "inv-recipient@example.showme.test",
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
      targetKind: "profile",
      targetName: "inv-owner",
      role: "editor",
      recipientName: "Rae Recipient",
      // Their own address, in full, because it is theirs.
      recipientEmail: "inv-recipient@example.showme.test",
      boundToEmail: true,
      viewer: { signedIn: true, emailMatches: true, emailVerified: true },
    });
    // The offer never hands back the bearer secret the reader already holds.
    expect(summary.json().token).toBeUndefined();
    expect(summary.json().code).toBeUndefined();

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
        recipientEmail: "claim-user@example.showme.test",
        token: "claim-token-abc",
        targetProfileId: stub.id,
        role: "owner",
        createdByUser: "claim-host",
      })
      .returning();
    if (!invite) throw new Error("invite seed failed");

    const claimed = await claimWith("claim-token-abc", "claim-user");
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
        recipientEmail: "inv-ga-free-rec@example.showme.test",
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
        recipientEmail: `${recipient.userId}@example.showme.test`,
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
        recipientEmail: `${recipient.userId}@example.showme.test`,
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
        recipientEmail: `${recipient.userId}@example.showme.test`,
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
        recipientEmail: "second@example.showme.test",
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
        recipientEmail: `${invitee.userId}@example.showme.test`,
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
        recipientEmail: `${invitee.userId}@example.showme.test`,
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
        recipientEmail: `${invitee.userId}@example.showme.test`,
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
        recipientEmail: "inv-act-rec@example.showme.test",
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
    expect(JSON.stringify(rows.map((row) => row.summary))).not.toContain("@example.showme.test");
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
        recipientEmail: "someone-else@example.showme.test",
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

describe("GET /events/:id/invitations — the event's open invitations", () => {
  /** A host operator + their event, with the host standing on it. */
  async function seedEventWithHost(prefix: string) {
    const { db } = harness;
    const host = await seedOwnerWithProfile(`${prefix}-host`);
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Open Mic Wednesdays",
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

  it("shows an invitation the host just sent, before anybody accepts it", async () => {
    const { host, event } = await seedEventWithHost("pending-list");

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("pending-list-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "nils@example.showme.test",
        recipientName: "Nils Andersson",
        targetEventId: event.id,
        role: "co_host",
      },
    });
    expect(invite.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("pending-list-host"), "x-profile-id": host.profileId },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({
      status: "pending",
      recipientEmail: "nils@example.showme.test",
      recipientName: "Nils Andersson",
      role: "co_host",
    });
    // The redemption secrets are never on this shape — see EventInvitationResponse.
    expect(listed.json()[0].token).toBeUndefined();
    expect(listed.json()[0].code).toBeUndefined();
  });

  it("drops an invitation once it has been answered", async () => {
    const { db } = harness;
    const { host, event } = await seedEventWithHost("answered-list");
    // The INVITEE declines, not the host: an answer is the recipient's to give,
    // and the sender declining on their behalf is now refused outright.
    await seedUser("answered-list-invitee", "performer");

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("answered-list-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "answered-list-invitee@example.showme.test",
        targetEventId: event.id,
        role: "crew",
      },
    });
    const token = invite.json().token as string;

    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/decline`,
      headers: auth("answered-list-invitee"),
    });
    expect(declined.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("answered-list-host"), "x-profile-id": host.profileId },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(0);
    // The row is still there — it left the LIST, not the record.
    const rows = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.targetEventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("declined");
  });

  it("hides an expired invitation, exactly as redemption does", async () => {
    const { db } = harness;
    const { host, event } = await seedEventWithHost("expired-list");

    await db.insert(schema.invitations).values({
      type: "event_participant",
      source: "collaborator",
      status: "pending",
      token: "expired-token-for-the-list",
      recipientEmail: "late@example.showme.test",
      targetEventId: event.id,
      role: "crew",
      expiresAt: new Date(Date.now() - 1000),
      createdByUser: "expired-list-host",
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("expired-list-host"), "x-profile-id": host.profileId },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(0);
  });

  it("refuses a participant who may not manage the roster (it carries emails)", async () => {
    const { db } = harness;
    const { host, event } = await seedEventWithHost("roster-guard");

    await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("roster-guard-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "private@example.showme.test",
        targetEventId: event.id,
        role: "performer",
      },
    });

    // A performer standing on the bill, with the performer preset — no
    // `participants.manage`, so no sight of who else was approached.
    await seedUser("roster-guard-performer", "performer");
    const [performerProfile] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "roster-guard-performer",
        name: "roster-guard-performer",
        slug: "roster-guard-performer",
      })
      .returning();
    if (!performerProfile) throw new Error("performer profile seed failed");
    await db.insert(schema.profileMembers).values({
      profileId: performerProfile.id,
      userId: "roster-guard-performer",
      role: "owner",
      status: "active",
    });
    const [performerSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: performerProfile.id,
        name: "performer",
        capabilities: [...PRESET_PERMISSION_SETS.performer],
      })
      .returning();
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performerProfile.id,
      role: "performer",
      permissionSetId: performerSet?.id,
      status: "confirmed",
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("roster-guard-performer"), "x-profile-id": performerProfile.id },
    });
    expect(listed.statusCode).toBe(403);
  });

  it("404s a stranger rather than admitting the event exists", async () => {
    const { event } = await seedEventWithHost("stranger-list");
    const stranger = await seedOwnerWithProfile("stranger-list-outsider");

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("stranger-list-outsider"), "x-profile-id": stranger.profileId },
    });
    expect(listed.statusCode).toBe(404);
  });
});

describe("the invitation email — what actually goes out", () => {
  /**
   * The send is best-effort and swallowed on failure (a mail hiccup must never
   * lose a persisted, redeemable invitation), which is exactly why it needs a
   * test: a silently broken send looks identical to a working one from the
   * outside. Nothing leaves the machine — the sink records instead of sending,
   * the same shape `createNoopEmailSink` has locally.
   */
  const sent: EmailMessage[] = [];
  let emailApp: FastifyInstance;

  beforeAll(async () => {
    emailApp = buildTestApp(
      {
        database: harness.db,
        tokenVerifier: fakeVerifier,
        emailSink: {
          async sendEmail(message) {
            sent.push(message);
          },
        },
      },
      [invitationRoutes],
    );
    await emailApp.ready();
  });

  afterAll(async () => {
    await emailApp?.close();
  });

  it("addresses the invitee, names the event, and carries a link that redeems", async () => {
    const { db } = harness;
    const host = await seedOwnerWithProfile("email-host");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Open Mic Wednesdays",
        baseCurrency: "SEK",
        createdBy: "email-host",
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

    const created = await emailApp.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("email-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "daniel@showme.test",
        recipientName: "Daniel",
        targetEventId: event.id,
        role: "co_host",
      },
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().token as string;

    const message = sent.find((entry) => entry.to === "daniel@showme.test");
    expect(message).toBeDefined();
    // The subject has to say WHICH event, or the invitation is unidentifiable in
    // an inbox that may hold several.
    expect(message?.subject).toContain("Open Mic Wednesdays");
    expect(message?.subject).toContain("email-host");
    // The link is the whole payload: it must carry the invitation's own token,
    // which is what `GET /invitations/:token` then resolves.
    expect(message?.html).toContain(`/invitations/${token}`);
    expect(message?.text).toContain(`/invitations/${token}`);

    // …and that link really does resolve to this invitation.
    const preview = await emailApp.inject({
      method: "GET",
      url: `/api/v1/invitations/${token}`,
      headers: auth("email-host"),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().targetEventId).toBe(event.id);
    expect(preview.json().status).toBe("pending");
  });
});

/**
 * THE RECIPIENT CHECK, and the offer the redemption page reads before it asks
 * anyone to answer.
 *
 * Until this landed, the token was the entire grant on all four routes: a
 * forwarded link let a stranger accept in the invitee's place, decline on their
 * behalf, or take ownership of an unclaimed profile — and `GET /invitations/:token`
 * handed the whole row, token included, to any authenticated caller. The old app
 * enforced the address on every redemption
 * (`docs/old-app-analysis-flows-invite-settle.md` §4); these are that rule,
 * asserted per route so it cannot quietly come off one of them again.
 */
describe("invitations — the invitation is bound to the address it names", () => {
  /**
   * Same identities, but Firebase has NOT confirmed the address. Anyone may
   * register any email at Firebase without proving they hold it, so this is the
   * "right address, no evidence" case — and it must be refused for the same
   * reason `claimStubsForEmail` has always refused it.
   */
  const unverifiedVerifier: TokenVerifier = {
    async verify(token: string) {
      return {
        uid: token,
        email: `${token}@example.showme.test`,
        emailVerified: false,
        name: token,
      };
    },
  };
  let unverifiedApp: FastifyInstance;

  beforeAll(async () => {
    unverifiedApp = buildTestApp({ database: harness.db, tokenVerifier: unverifiedVerifier }, [
      invitationRoutes,
    ]);
    await unverifiedApp.ready();
  });

  afterAll(async () => {
    await unverifiedApp?.close();
  });

  /** An invited-but-unredeemed profile membership, addressed to `<prefix>-invitee`. */
  async function seedPendingInvitation(prefix: string) {
    const { db } = harness;
    const owner = await seedOwnerWithProfile(`${prefix}-owner`);
    await seedUser(`${prefix}-invitee`, "performer");
    await seedUser(`${prefix}-stranger`, "performer");
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "team",
        status: "pending",
        token: `${prefix}-token`,
        recipientEmail: `${prefix}-invitee@example.showme.test`,
        recipientName: "Rae Recipient",
        targetProfileId: owner.profileId,
        role: "editor",
        createdByUser: `${prefix}-owner`,
      })
      .returning();
    if (!invitation) throw new Error("invitation seed failed");
    return { owner, invitation };
  }

  it("refuses an ACCEPT from a different address, and grants nothing", async () => {
    const { owner, invitation } = await seedPendingInvitation("bind-accept");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/accept`,
      headers: auth("bind-accept-stranger"),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe(
      "This invitation was sent to a different email address",
    );

    // The state, not just the status: nothing was granted and the real invitee
    // can still answer.
    const members = await harness.db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.profileId, owner.profileId),
          eq(schema.profileMembers.userId, "bind-accept-stranger"),
        ),
      );
    expect(members).toHaveLength(0);
    const [after] = await harness.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending");

    // The positive control, same body: the addressee is let through.
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/accept`,
      headers: auth("bind-accept-invitee"),
    });
    expect(accepted.statusCode).toBe(200);
  });

  it("refuses an ACCEPT from the right address while it is unverified", async () => {
    const { invitation } = await seedPendingInvitation("bind-unverified");

    const response = await unverifiedApp.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/accept`,
      headers: auth("bind-unverified-invitee"),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe(
      "Verify your email address before redeeming this invitation",
    );

    const [after] = await harness.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending");
  });

  it("refuses a DECLINE from a different address — a stranger cannot close the slot", async () => {
    const { invitation } = await seedPendingInvitation("bind-decline");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/decline`,
      headers: auth("bind-decline-stranger"),
    });
    expect(response.statusCode).toBe(403);

    const [after] = await harness.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending");

    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${invitation.token}/decline`,
      headers: auth("bind-decline-invitee"),
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().status).toBe("declined");
  });

  it("refuses a CLAIM from a different address, and leaves the profile unclaimed", async () => {
    const { db } = harness;
    await seedOwnerWithProfile("bind-claim-host");
    await seedUser("bind-claim-invitee", "performer");
    await seedUser("bind-claim-stranger", "performer");
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "bind-claim-host",
        name: "Unclaimed Act",
        slug: "bind-claim-stub",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "venue_handoff",
        status: "pending",
        token: "bind-claim-token",
        recipientEmail: "bind-claim-invitee@example.showme.test",
        targetProfileId: stub.id,
        createdByUser: "bind-claim-host",
      })
      .returning();
    if (!invitation) throw new Error("invitation seed failed");

    // THE RULE THIS ASSERTS CHANGED ON 2026-09-01, and it is worth being precise
    // about how. It used to be "your signed-in address must equal the invited
    // one", which stopped this stranger — and also stopped the person who runs a
    // venue invited at `info@` from ever claiming it. It is now "prove the
    // invited address with a code that was sent to it", so what stops the
    // stranger is that the code did not come to them.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/bind-claim-token/claim",
      headers: auth("bind-claim-stranger"),
      payload: { otp: "000000" },
    });
    expect(response.statusCode).toBe(403);

    // And the code goes to the INVITED address — never to the caller's, which is
    // the property the whole rule rests on. Asking for one as a stranger tells
    // them nothing and mails them nothing.
    const before = sentFromApp.length;
    await app.inject({
      method: "POST",
      url: "/api/v1/invitations/bind-claim-token/claim-otp",
      headers: auth("bind-claim-stranger"),
    });
    expect(sentFromApp.slice(before).map((message) => message.to)).toEqual([
      "bind-claim-invitee@example.showme.test",
    ]);

    const [untouched] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.id));
    expect(untouched?.claimedAt).toBeNull();
    expect(untouched?.ownerUserId).toBe("bind-claim-host");

    const claimed = await claimWith("bind-claim-token", "bind-claim-invitee");
    expect(claimed.statusCode).toBe(200);
  });

  it("refuses a CLAIM of an invitation that names nobody", async () => {
    const { db } = harness;
    await seedOwnerWithProfile("bind-open-host");
    await seedUser("bind-open-passerby", "performer");
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "bind-open-host",
        name: "Nobody's Act",
        slug: "bind-open-stub",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "venue_handoff",
      status: "pending",
      token: "bind-open-token",
      targetProfileId: stub.id,
      createdByUser: "bind-open-host",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/bind-open-token/claim",
      headers: auth("bind-open-passerby"),
      // A code cannot even be requested for an invitation that names nobody —
      // there is no address to send it to — so this is any six digits.
      payload: { otp: "000000" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe(
      "This invitation is not addressed to anyone, so it cannot be claimed",
    );

    const [untouched] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.id));
    expect(untouched?.claimedAt).toBeNull();
  });

  it("still lets an UNBOUND invitation be redeemed by whoever holds it", async () => {
    const owner = await seedOwnerWithProfile("bind-none-owner");
    await seedUser("bind-none-holder", "performer");
    await harness.db.insert(schema.invitations).values({
      type: "profile_member",
      source: "team",
      status: "pending",
      token: "bind-none-token",
      targetProfileId: owner.profileId,
      role: "viewer",
      createdByUser: "bind-none-owner",
    });

    // No address was ever named, so there is nothing to check against and the
    // token is the grant — deliberately, for a link handed over in person.
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/bind-none-token/accept",
      headers: auth("bind-none-holder"),
    });
    expect(accepted.statusCode).toBe(200);
  });
});

/**
 * The offer, read by whoever opened the link. Every one of these states used to
 * be the same thing from the recipient's side — nothing happening — because the
 * email pointed at a URL the app ignored. The page can only say what happened
 * if the API names it.
 */
describe("GET /invitations/:token — the offer a link-holder reads", () => {
  it("answers an anonymous reader, masks the address, and withholds the token", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("offer-anon-owner");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "team",
      status: "pending",
      token: "offer-anon-token",
      recipientEmail: "Daniel@ShowMe.Test",
      recipientName: "Daniel",
      targetProfileId: owner.profileId,
      role: "editor",
      createdByUser: "offer-anon-owner",
    });

    // No Authorization header at all — the reader has no account yet, which is
    // the whole reason this route is public.
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/offer-anon-token",
    });
    expect(response.statusCode).toBe(200);
    const offer = response.json();
    expect(offer.status).toBe("pending");
    expect(offer.role).toBe("editor");
    expect(offer.targetKind).toBe("profile");
    expect(offer.inviterName).toBe("offer-anon-owner");
    expect(offer.recipientName).toBe("Daniel");
    expect(offer.viewer).toEqual({ signedIn: false, emailMatches: false, emailVerified: false });
    // The target profile is the inviter's own, long since claimed — so the
    // answer on offer is "join", not "take this over".
    expect(offer.claimable).toBe(false);
    // Enough for its owner to recognise, useless to anyone else — and the
    // address is never returned in full to a stranger, whatever its casing.
    expect(offer.recipientEmail).toBe("d•••@s•••.test");
    expect(JSON.stringify(offer)).not.toContain("daniel@showme.test");
    expect(JSON.stringify(offer)).not.toContain("offer-anon-token");
  });

  it("tells a signed-in stranger it is not theirs, without naming the invitee", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("offer-wrong-owner");
    await seedUser("offer-wrong-stranger", "performer");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "team",
      status: "pending",
      token: "offer-wrong-token",
      recipientEmail: "invitee@elsewhere.showme.test",
      targetProfileId: owner.profileId,
      role: "editor",
      createdByUser: "offer-wrong-owner",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/offer-wrong-token",
      headers: auth("offer-wrong-stranger"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().viewer).toEqual({
      signedIn: true,
      emailMatches: false,
      emailVerified: true,
    });
    expect(response.json().recipientEmail).toBe("i•••@e•••.showme.test");
  });

  it("names the terminal states instead of 404ing them", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("offer-terminal-owner");
    const base = {
      type: "profile_member" as const,
      source: "team" as const,
      targetProfileId: owner.profileId,
      createdByUser: "offer-terminal-owner",
    };
    await db.insert(schema.invitations).values([
      // Still `pending` in the column, but past its date — the page must be able
      // to say "you are late", not "we have never seen this link".
      {
        ...base,
        status: "pending",
        token: "offer-expired-token",
        expiresAt: new Date(Date.now() - 60_000),
      },
      { ...base, status: "revoked", token: "offer-revoked-token" },
      { ...base, status: "accepted", token: "offer-accepted-token" },
      { ...base, status: "declined", token: "offer-declined-token" },
    ]);

    for (const [token, status] of [
      ["offer-expired-token", "expired"],
      ["offer-revoked-token", "revoked"],
      ["offer-accepted-token", "accepted"],
      ["offer-declined-token", "declined"],
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/invitations/${token}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(status);
    }

    // …while the redemption routes still treat expiry as gone.
    const accept = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/offer-expired-token/accept",
      headers: auth("offer-terminal-owner"),
    });
    expect(accept.statusCode).toBe(404);
  });

  it("says an unclaimed profile is claimable, and stops saying so once it is claimed", async () => {
    const { db } = harness;
    await seedOwnerWithProfile("offer-claim-host");
    await seedUser("offer-claim-invitee", "performer");
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "offer-claim-host",
        name: "Held For You",
        slug: "offer-claim-stub",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "venue_handoff",
      status: "pending",
      token: "offer-claim-token",
      recipientEmail: "offer-claim-invitee@example.showme.test",
      targetProfileId: stub.id,
      createdByUser: "offer-claim-host",
    });

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/offer-claim-token",
    });
    expect(before.json().claimable).toBe(true);
    expect(before.json().targetName).toBe("Held For You");

    const claimed = await claimWith("offer-claim-token", "offer-claim-invitee");
    expect(claimed.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/offer-claim-token",
    });
    expect(after.json().status).toBe("used");
    expect(after.json().claimable).toBe(false);
  });

  it("404s a token that was never issued", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/invitations/never-issued-at-all",
    });
    expect(response.statusCode).toBe(404);
  });
});

/**
 * EXPIRY AND WITHDRAWAL — the two ways an invitation stops being an open offer
 * without anybody answering it.
 *
 * Both were half-built: `expires_at` was read by four guards and written by no
 * insert, and `revoked` was an enum value with no writer at all. An invitation
 * that cannot run out and cannot be taken back is a permanent grant nobody
 * remembers issuing.
 */
describe("invitations — expiry and revocation", () => {
  /** A host operator + their event, with the host standing on it. */
  async function seedHostAndEvent(prefix: string) {
    const { db } = harness;
    const host = await seedOwnerWithProfile(`${prefix}-host`);
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Withdrawal Test",
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

  it("stamps `expires_at` at create — 30 days, and 90 for a venue handoff", async () => {
    const owner = await seedOwnerWithProfile("expiry-create");

    const send = async (source: string) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/invitations",
        headers: { ...auth("expiry-create"), "x-profile-id": owner.profileId },
        payload: {
          type: "profile_member",
          source,
          targetProfileId: owner.profileId,
          role: "viewer",
        },
      });
      expect(created.statusCode).toBe(201);
      const [row] = await harness.db
        .select({ expiresAt: schema.invitations.expiresAt })
        .from(schema.invitations)
        .where(eq(schema.invitations.id, created.json().id));
      return row?.expiresAt ?? null;
    };

    const DAY_MS = 24 * 60 * 60 * 1000;
    const ordinary = await send("team");
    const handoff = await send("venue_handoff");
    if (!ordinary || !handoff) throw new Error("expires_at was not written");

    const daysFromNow = (date: Date) => Math.round((date.getTime() - Date.now()) / DAY_MS);
    expect(daysFromNow(ordinary)).toBe(30);
    expect(daysFromNow(handoff)).toBe(90);
  });

  it("refuses to redeem a stamped invitation once its date has passed", async () => {
    const { db } = harness;
    const owner = await seedOwnerWithProfile("expiry-bite");
    await seedUser("expiry-bite-invitee", "performer");
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "team",
        status: "pending",
        token: "expiry-bite-token",
        recipientEmail: "expiry-bite-invitee@example.showme.test",
        targetProfileId: owner.profileId,
        role: "editor",
        expiresAt: new Date(Date.now() - 60_000),
        createdByUser: "expiry-bite",
      })
      .returning();
    if (!invitation) throw new Error("invitation seed failed");

    // Gone, for every verb — and WITHOUT the reaper having run, which is the
    // point: the column is the authority, the sweep only tidies the status.
    // `claim-otp` is in the list because an expired invitation must not even be
    // able to send a code — otherwise the dead link still puts mail in somebody's
    // inbox. `claim` carries a body because the route requires one; the value is
    // irrelevant, since the invitation is gone before the code is ever read.
    for (const verb of ["accept", "decline", "claim", "claim-otp"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/expiry-bite-token/${verb}`,
        headers: auth("expiry-bite-invitee"),
        payload: verb === "claim" ? { otp: "000000" } : undefined,
      });
      expect(response.statusCode).toBe(404);
    }

    const [after] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(after?.status).toBe("pending"); // still un-swept, and still refused

    // …and the offer names it rather than 404ing, so the page can say why.
    const offer = await app.inject({ method: "GET", url: "/api/v1/invitations/expiry-bite-token" });
    expect(offer.statusCode).toBe(200);
    expect(offer.json().status).toBe("expired");
  });

  it("lets the sender withdraw an open invitation, and closes it for the recipient", async () => {
    const { db } = harness;
    const { host, event } = await seedHostAndEvent("revoke-ok");
    await seedUser("revoke-ok-invitee", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("revoke-ok-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "revoke-ok-invitee@example.showme.test",
        recipientName: "Rae Recipient",
        targetEventId: event.id,
        role: "performer",
      },
    });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json();

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${id}/revoke`,
      headers: { ...auth("revoke-ok-host"), "x-profile-id": host.profileId },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");

    // The row is KEPT — that is the whole argument against the old app's
    // delete-four-documents revoke.
    const [after] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, id));
    expect(after?.status).toBe("revoked");

    // The recipient is told what happened, not that it never existed…
    const offer = await app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
    expect(offer.json().status).toBe("revoked");

    // …and cannot redeem it.
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      headers: auth("revoke-ok-invitee"),
    });
    expect(accept.statusCode).toBe(409);
    // The reason, not a generic one: nobody USED this invitation, and telling
    // the recipient they did sends them hunting for a redemption they never made.
    expect(accept.json().error.message).toBe("This invitation was withdrawn by the sender");

    // It leaves the roster, and leaves a trace in the event's history.
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { ...auth("revoke-ok-host"), "x-profile-id": host.profileId },
    });
    expect(listed.json()).toHaveLength(0);

    const activity = await db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, event.id));
    expect(activity.map((row) => row.type).sort()).toEqual([
      "invitation.revoked",
      "invitation.sent",
    ]);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "invitation.revoke"));
    expect(audit).toHaveLength(1);
  });

  it("refuses a withdrawal from someone who could not have sent it", async () => {
    const { db } = harness;
    const { host, event } = await seedHostAndEvent("revoke-guard");
    const outsider = await seedOwnerWithProfile("revoke-guard-outsider");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("revoke-guard-host"), "x-profile-id": host.profileId },
      payload: {
        type: "event_participant",
        source: "collaborator",
        recipientEmail: "someone@example.showme.test",
        targetEventId: event.id,
        role: "performer",
      },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${id}/revoke`,
      headers: { ...auth("revoke-guard-outsider"), "x-profile-id": outsider.profileId },
    });
    // 404, not 403: a stranger learns nothing about an event they cannot see.
    expect(response.statusCode).toBe(404);

    const [after] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, id));
    expect(after?.status).toBe("pending");
  });

  it("refuses to withdraw an invitation that has already been answered", async () => {
    const owner = await seedOwnerWithProfile("revoke-late");
    await seedUser("revoke-late-invitee", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth("revoke-late"), "x-profile-id": owner.profileId },
      payload: {
        type: "profile_member",
        source: "team",
        recipientEmail: "revoke-late-invitee@example.showme.test",
        targetProfileId: owner.profileId,
        role: "editor",
      },
    });
    const { id, token } = created.json();

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      headers: auth("revoke-late-invitee"),
    });
    expect(accepted.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${id}/revoke`,
      headers: { ...auth("revoke-late"), "x-profile-id": owner.profileId },
    });
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json().error.message).toBe("This invitation has already been answered");
  });
});

/**
 * The claim leaves ONE membership behind, not two.
 *
 * A stub carries a `{user_id: null, email}` row — the email IS the claim key. The
 * token route used to insert a second owner row beside it and leave the original
 * pointing at nobody; the unique constraint never caught it, because the stale
 * row's `user_id` is NULL.
 */
describe("invitations — claiming links the stub's own membership", () => {
  it("links the email-bearing row instead of adding a second owner", async () => {
    const { db } = harness;
    await seedOwnerWithProfile("link-host");
    await seedUser("link-invitee", "performer");

    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "link-host",
        name: "Unclaimed Act",
        slug: "link-stub",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    // Exactly what `createPerformerStub` writes — including the mixed casing an
    // operator actually types, which the claim has to match case-insensitively.
    const [stubMember] = await db
      .insert(schema.profileMembers)
      .values({
        profileId: stub.id,
        userId: null,
        email: "Link-Invitee@Example.ShowMe.Test",
        displayName: "Unclaimed Act",
        role: "owner",
        status: "active",
        addedBy: "link-host",
      })
      .returning();
    if (!stubMember) throw new Error("member seed failed");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "venue_handoff",
      status: "pending",
      token: "link-token",
      recipientEmail: "link-invitee@example.showme.test",
      targetProfileId: stub.id,
      createdByUser: "link-host",
    });

    const claimed = await claimWith("link-token", "link-invitee");
    expect(claimed.statusCode).toBe(200);

    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, stub.id));
    // ONE row — the original, now pointing at a real person.
    expect(members).toHaveLength(1);
    expect(members[0]?.id).toBe(stubMember.id);
    expect(members[0]?.userId).toBe("link-invitee");
    expect(members[0]?.role).toBe("owner");
  });

  it("still makes the claimer an owner when the stub carries no membership row", async () => {
    const { db } = harness;
    await seedOwnerWithProfile("nolink-host");
    await seedUser("nolink-invitee", "operator");

    // A venue handoff mints the stub with no `profile_members` row at all
    // (`routes/inbound.ts`), so there is nothing to link — the claimer must
    // still come out of it owning the profile.
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "nolink-host",
        name: "Unclaimed Venue",
        slug: "nolink-stub",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    await db.insert(schema.invitations).values({
      type: "event_participant",
      source: "venue_handoff",
      status: "pending",
      token: "nolink-token",
      recipientEmail: "nolink-invitee@example.showme.test",
      targetProfileId: stub.id,
      createdByUser: "nolink-host",
    });

    const claimed = await claimWith("nolink-token", "nolink-invitee");
    expect(claimed.statusCode).toBe(200);

    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, stub.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe("nolink-invitee");
    expect(members[0]?.role).toBe("owner");
  });
});

/**
 * THE COLLABORATION-CREDIT CAP (ClickUp 86cbcbgx2).
 *
 * The rule these prove, in the words it was decided in: performers only, external
 * invitations only, and "when they get a response they get 1 back".
 *
 * Worth stating what makes these tests capable of failing, because the feature
 * they cover spent months looking finished: `credit_ledger` and a balance reader
 * existed all along and every balance was 0, so ANY assertion that the balance
 * "looks right" passed while nothing was wired up. These assert the DIFFERENCE a
 * send makes, which is the thing that was missing.
 */
describe("invitations — the collaboration-credit cap", () => {
  /** A performer profile, since the cap applies to that kind and no other. */
  async function seedPerformerSender(id: string) {
    const { db } = harness;
    await seedUser(id, "performer");
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "performer", ownerUserId: id, name: id, slug: id, claimedAt: new Date() })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
    return { profileId: profile.id };
  }

  async function balanceOf(profileId: string): Promise<number> {
    return collaborationCreditBalance(harness.db, profileId);
  }

  function inviteTo(uid: string, profileId: string, email: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      headers: { ...auth(uid), "x-profile-id": profileId },
      payload: {
        type: "profile_member",
        source: "collaborator",
        recipientEmail: email,
        recipientName: "Someone",
        targetProfileId: profileId,
        role: "editor",
      },
    });
  }

  it("charges a credit for an invitation to somebody NOT on shoWMe", async () => {
    const sender = await seedPerformerSender("cred-external");
    expect(await balanceOf(sender.profileId)).toBe(COLLABORATION_INVITE_CREDITS);

    const created = await inviteTo("cred-external", sender.profileId, "nobody@example.test");
    expect(created.statusCode).toBe(201);

    expect(await balanceOf(sender.profileId)).toBe(COLLABORATION_INVITE_CREDITS - 1);
  });

  it("charges NOTHING for an invitation to somebody who already has an account", async () => {
    const sender = await seedPerformerSender("cred-internal");
    await seedUser("cred-internal-invitee", "performer");

    const created = await inviteTo(
      "cred-internal",
      sender.profileId,
      "cred-internal-invitee@example.showme.test",
    );
    expect(created.statusCode).toBe(201);

    // Inviting a colleague who is already here is collaboration, not outreach.
    expect(await balanceOf(sender.profileId)).toBe(COLLABORATION_INVITE_CREDITS);
  });

  it("gives the credit back when the invitation is DECLINED, not just accepted", async () => {
    const sender = await seedPerformerSender("cred-declined");
    await seedUser("cred-decliner", "performer");
    // Sent to an address with no account, so it is charged...
    const created = await inviteTo("cred-declined", sender.profileId, "cred-decliner@nowhere.test");
    expect(created.statusCode).toBe(201);
    expect(await balanceOf(sender.profileId)).toBe(COLLABORATION_INVITE_CREDITS - 1);

    // ...then the address is claimed by a real account, which declines it.
    const token = created.json().token as string;
    await harness.db
      .update(schema.invitations)
      .set({ recipientEmail: "cred-decliner@example.showme.test" })
      .where(eq(schema.invitations.token, token));

    const declined = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/decline`,
      headers: auth("cred-decliner"),
    });
    expect(declined.statusCode).toBe(200);

    // Ran's spec said declines don't refill. Daniel's rule says a RESPONSE does.
    expect(await balanceOf(sender.profileId)).toBe(COLLABORATION_INVITE_CREDITS);
  });

  it("refuses the send once every credit is out, and does not offer an upgrade", async () => {
    const sender = await seedPerformerSender("cred-empty");
    // Spend the allowance directly — twenty round trips would prove nothing extra.
    for (let index = 0; index < COLLABORATION_INVITE_CREDITS; index += 1) {
      await harness.db.insert(schema.creditLedger).values({
        profileId: sender.profileId,
        delta: -1,
        reason: `invite:seeded-${index}`,
      });
    }
    expect(await balanceOf(sender.profileId)).toBe(0);

    const refused = await inviteTo("cred-empty", sender.profileId, "one-too-many@nowhere.test");
    expect(refused.statusCode).toBe(403);
    // NOT `entitlement_required`: there is no performer PRO to sell yet, so the
    // refusal must not render as an upgrade prompt.
    expect(refused.json().error.code).toBe("forbidden");
    expect(refused.json().error.message).toContain("waiting for a reply");
  });

  it("does not cap an OPERATOR, however many invitations they send", async () => {
    const owner = await seedOwnerWithProfile("cred-operator");
    for (let index = 0; index < COLLABORATION_INVITE_CREDITS; index += 1) {
      await harness.db.insert(schema.creditLedger).values({
        profileId: owner.profileId,
        delta: -1,
        reason: `invite:op-${index}`,
      });
    }

    const created = await inviteTo("cred-operator", owner.profileId, "venue-guest@nowhere.test");
    // A venue curating its own roster is the quality filter — Ran's spec is
    // explicit that this kind is uncapped.
    expect(created.statusCode).toBe(201);
  });
});

/**
 * THE OTP CLAIM (ClickUp 86cbcbgbe / 86cbcbgmu, migration 0033).
 *
 * The behaviour that did not exist before: the invited address is PROVED with a
 * code, and the account it becomes can then belong to a different address
 * entirely. Every other claim test above proves the rule still holds for the
 * ordinary case; these two prove the case it was changed for.
 */
describe("invitations — claiming under a different address", () => {
  it("lets somebody claim with a code, signed in as a DIFFERENT address", async () => {
    const { db } = harness;
    await seedUser("otp-host", "operator");
    // The person who actually runs the venue. Their account is their own name,
    // not the `info@` address the invitation was sent to — which is the entire
    // case the old equality rule made impossible.
    await seedUser("otp-real-person", "operator");
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "otp-host",
        name: "The Lantern Hall",
        slug: "otp-lantern",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "venue_handoff",
      status: "pending",
      token: "otp-different-token",
      recipientEmail: "info@lanternhall.test",
      targetProfileId: stub.id,
      createdByUser: "otp-host",
    });

    const claimed = await claimWith("otp-different-token", "otp-real-person");
    expect(claimed.statusCode).toBe(200);

    const [after] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, stub.id));
    expect(after?.ownerUserId).toBe("otp-real-person");
    expect(after?.claimedAt).not.toBeNull();
  });

  it("refuses a wrong code, and tells the invited address once it IS claimed", async () => {
    const { db } = harness;
    await seedUser("otp-notice-host", "operator");
    await seedUser("otp-notice-claimer", "operator");
    const [stub] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "otp-notice-host",
        name: "Notice Hall",
        slug: "otp-notice",
        claimedAt: null,
      })
      .returning();
    if (!stub) throw new Error("stub seed failed");
    await db.insert(schema.invitations).values({
      type: "profile_member",
      source: "venue_handoff",
      status: "pending",
      token: "otp-notice-token",
      recipientEmail: "desk@noticehall.test",
      targetProfileId: stub.id,
      createdByUser: "otp-notice-host",
    });

    // A real code exists, and a wrong guess is still refused.
    const realCode = await requestClaimCode("otp-notice-token", "otp-notice-claimer");
    const wrong = String((Number(realCode) + 1) % 1000000).padStart(6, "0");
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/otp-notice-token/claim",
      headers: auth("otp-notice-claimer"),
      payload: { otp: wrong },
    });
    expect(refused.statusCode).toBe(403);
    const [stillUnclaimed] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.id));
    expect(stillUnclaimed?.claimedAt).toBeNull();

    // The right code claims it, and the INVITED address is told what became of
    // the account — the transparency half, and the safety net for the fact that
    // the claimer's own address is now allowed to differ.
    const before = sentFromApp.length;
    const claimed = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/otp-notice-token/claim",
      headers: auth("otp-notice-claimer"),
      payload: { otp: realCode },
    });
    expect(claimed.statusCode).toBe(200);

    const notice = sentFromApp
      .slice(before)
      .find((message) => message.to === "desk@noticehall.test");
    expect(notice).toBeDefined();
    expect(notice?.subject).toContain("Notice Hall");
  });
});
