import { randomUUID } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reapDueRepresentationTerminations,
  reapExpiredHandoffs,
  reapExpiredOffers,
  reapExpiredShares,
  reapUnclaimedStubs,
} from "./reapers";

let harness: TestDatabase;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** A minimal owner user + profile to satisfy the FKs the reaped rows hang off. */
async function seedProfile(
  slug: string,
  kind: "operator" | "performer" | "agent" = "operator",
): Promise<{ userId: string; profileId: string }> {
  const userId = `user-${randomUUID()}`;
  await harness.db.insert(schema.users).values({ id: userId, email: `${slug}@example.com`, kind });
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: userId, name: slug, slug })
    .returning({ id: schema.profiles.id });
  if (!profile) throw new Error("failed to seed profile");
  return { userId, profileId: profile.id };
}

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

describe("reapExpiredOffers", () => {
  it("expires only stale, pending performer offers", async () => {
    const { profileId } = await seedProfile(`offers-${randomUUID()}`);

    // Each row names a different night: `wanted_date` is NOT NULL since migration
    // 0031 (a request always names a date), and the pending-dedup index would
    // collide two pending offers from one sender for one night.
    const [stale] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "pending",
        targetProfileId: profileId,
        wantedDate: "2027-01-05",
        createdAt: daysAgo(40),
      })
      .returning({ id: schema.bookingRequests.id });
    const [fresh] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "pending",
        targetProfileId: profileId,
        wantedDate: "2027-01-06",
        createdAt: daysAgo(5),
      })
      .returning({ id: schema.bookingRequests.id });
    const [wrongSource] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "public_form",
        status: "pending",
        targetProfileId: profileId,
        wantedDate: "2027-01-07",
        createdAt: daysAgo(40),
      })
      .returning({ id: schema.bookingRequests.id });
    const [alreadyAccepted] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "accepted",
        targetProfileId: profileId,
        wantedDate: "2027-01-08",
        createdAt: daysAgo(40),
      })
      .returning({ id: schema.bookingRequests.id });
    if (!stale || !fresh || !wrongSource || !alreadyAccepted) throw new Error("seed failed");

    const count = await reapExpiredOffers(harness.db, NOW);
    expect(count).toBe(1);

    const statusOf = async (id: string) => {
      const [row] = await harness.db
        .select({ status: schema.bookingRequests.status })
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      return row?.status;
    };
    expect(await statusOf(stale.id)).toBe("expired");
    expect(await statusOf(fresh.id)).toBe("pending");
    expect(await statusOf(wrongSource.id)).toBe("pending");
    expect(await statusOf(alreadyAccepted.id)).toBe("accepted");
  });
});

describe("reapExpiredHandoffs", () => {
  it("expires only stale, pending venue handoffs", async () => {
    const { userId } = await seedProfile(`handoffs-${randomUUID()}`);

    const [stale] = await harness.db
      .insert(schema.invitations)
      .values({
        type: "event_participant",
        source: "venue_handoff",
        status: "pending",
        createdByUser: userId,
        createdAt: daysAgo(100),
      })
      .returning({ id: schema.invitations.id });
    const [fresh] = await harness.db
      .insert(schema.invitations)
      .values({
        type: "event_participant",
        source: "venue_handoff",
        status: "pending",
        createdByUser: userId,
        createdAt: daysAgo(10),
      })
      .returning({ id: schema.invitations.id });
    const [wrongSource] = await harness.db
      .insert(schema.invitations)
      .values({
        type: "profile_member",
        source: "collaborator",
        status: "pending",
        createdByUser: userId,
        createdAt: daysAgo(100),
      })
      .returning({ id: schema.invitations.id });
    if (!stale || !fresh || !wrongSource) throw new Error("seed failed");

    const count = await reapExpiredHandoffs(harness.db, NOW);
    expect(count).toBe(1);

    const statusOf = async (id: string) => {
      const [row] = await harness.db
        .select({ status: schema.invitations.status })
        .from(schema.invitations)
        .where(eq(schema.invitations.id, id));
      return row?.status;
    };
    expect(await statusOf(stale.id)).toBe("expired");
    expect(await statusOf(fresh.id)).toBe("pending");
    expect(await statusOf(wrongSource.id)).toBe("pending");
  });

  /**
   * The column, not the calendar. Every invitation now carries `expires_at`
   * stamped at create, whatever its source — so the sweep follows that rather
   * than re-deriving a duration from `created_at`, and a young invitation with a
   * short life is reaped while an old one that is still in date is left alone.
   */
  it("expires any pending invitation past its `expires_at`, whatever its source", async () => {
    const { userId } = await seedProfile(`expiry-${randomUUID()}`);

    const insert = async (values: Record<string, unknown>) => {
      const [row] = await harness.db
        .insert(schema.invitations)
        .values({
          type: "profile_member",
          source: "collaborator",
          status: "pending",
          createdByUser: userId,
          ...values,
        })
        .returning({ id: schema.invitations.id });
      if (!row) throw new Error("seed failed");
      return row.id;
    };

    // Created yesterday, but only good for an hour — the created_at rule would
    // have called this fresh and left it live.
    const shortLived = await insert({
      createdAt: daysAgo(1),
      expiresAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    // Created long ago and still in date — the mirror image.
    const stillOpen = await insert({
      createdAt: daysAgo(200),
      expiresAt: daysAgo(-30),
    });
    // Already answered: an expiry sweep must never move a settled row.
    const declined = await insert({
      status: "declined",
      expiresAt: daysAgo(5),
    });

    const count = await reapExpiredHandoffs(harness.db, NOW);
    expect(count).toBe(1);

    const statusOf = async (id: string) => {
      const [row] = await harness.db
        .select({ status: schema.invitations.status })
        .from(schema.invitations)
        .where(eq(schema.invitations.id, id));
      return row?.status;
    };
    expect(await statusOf(shortLived)).toBe("expired");
    expect(await statusOf(stillOpen)).toBe("pending");
    expect(await statusOf(declined)).toBe("declined");
  });
});

describe("reapExpiredShares", () => {
  it("revokes expired shares and deletes expired OTPs", async () => {
    const { userId, profileId } = await seedProfile(`shares-${randomUUID()}`);

    const insertShare = async (expiresAt: Date, revokedAt: Date | null) => {
      const [share] = await harness.db
        .insert(schema.shares)
        .values({
          token: `token-${randomUUID()}`,
          ownerUserId: userId,
          ownerProfileId: profileId,
          expiresAt,
          revokedAt,
        })
        .returning({ id: schema.shares.id });
      if (!share) throw new Error("seed failed");
      return share.id;
    };

    const expiredShareId = await insertShare(daysAgo(1), null);
    const futureShareId = await insertShare(new Date(NOW.getTime() + DAY_MS), null);
    const alreadyRevokedId = await insertShare(daysAgo(2), daysAgo(1));

    const insertOtp = async (shareId: string, expiresAt: Date, emailHash: string) => {
      const [otp] = await harness.db
        .insert(schema.shareOtps)
        .values({ shareId, emailHash, codeHash: "code", salt: "salt", expiresAt })
        .returning({ id: schema.shareOtps.id });
      if (!otp) throw new Error("seed failed");
      return otp.id;
    };
    const expiredOtpId = await insertOtp(futureShareId, daysAgo(1), "hash-expired");
    const freshOtpId = await insertOtp(
      futureShareId,
      new Date(NOW.getTime() + DAY_MS),
      "hash-fresh",
    );

    const count = await reapExpiredShares(harness.db, NOW);
    expect(count).toBe(1);

    const revokedAtOf = async (id: string) => {
      const [row] = await harness.db
        .select({ revokedAt: schema.shares.revokedAt })
        .from(schema.shares)
        .where(eq(schema.shares.id, id));
      return row?.revokedAt;
    };
    expect(await revokedAtOf(expiredShareId)).toEqual(NOW);
    expect(await revokedAtOf(futureShareId)).toBeNull();
    // An already-revoked share keeps its original revocation timestamp (not re-stamped).
    expect(await revokedAtOf(alreadyRevokedId)).toEqual(daysAgo(1));

    const otpExists = async (id: string) => {
      const rows = await harness.db
        .select({ id: schema.shareOtps.id })
        .from(schema.shareOtps)
        .where(eq(schema.shareOtps.id, id));
      return rows.length > 0;
    };
    expect(await otpExists(expiredOtpId)).toBe(false);
    expect(await otpExists(freshOtpId)).toBe(true);
  });
});

/**
 * An ACTIVE representation whose agent already holds one still-open event: the
 * agent is a participant, the performer's own participation carries the
 * delegation flag. `terminatedEffectiveAt` decides whether the notice is due.
 */
async function seedRepresentedEvent(slug: string, terminatedEffectiveAt: Date) {
  const venue = await seedProfile(`${slug}-venue`);
  const agent = await seedProfile(`${slug}-agent`, "agent");
  const performer = await seedProfile(`${slug}-performer`, "performer");

  const [event] = await harness.db
    .insert(schema.events)
    .values({
      hostProfileId: venue.profileId,
      venueProfileId: venue.profileId,
      title: `${slug} show`,
      baseCurrency: "SEK",
      status: "on_hold",
      createdBy: venue.userId,
    })
    .returning({ id: schema.events.id });
  if (!event) throw new Error("failed to seed event");

  const [performerParticipant] = await harness.db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      status: "confirmed",
      details: { delegatedToAgentProfileId: agent.profileId, callTime: "18:00" },
    })
    .returning({ id: schema.eventParticipants.id });
  const [agentParticipant] = await harness.db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: agent.profileId,
      role: "agent",
      status: "accepted",
    })
    .returning({ id: schema.eventParticipants.id });

  const [representation] = await harness.db
    .insert(schema.representations)
    .values({
      agentProfileId: agent.profileId,
      performerProfileId: performer.profileId,
      region: ["SE"],
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
      terminatedAt: new Date("2026-07-01T00:00:00.000Z"),
      terminatedEffectiveAt,
      terminatedBy: performer.userId,
    })
    .returning({ id: schema.representations.id });
  if (!representation || !performerParticipant || !agentParticipant) {
    throw new Error("failed to seed representation");
  }

  return {
    representationId: representation.id,
    performerParticipantId: performerParticipant.id,
    agentParticipantId: agentParticipant.id,
  };
}

async function participantRow(id: string) {
  const [row] = await harness.db
    .select()
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.id, id));
  return row;
}

/**
 * A-19. A future-dated termination stays `active` on purpose — the agent works the
 * notice period. This reaper is what makes the STORED state catch up once the
 * agreed moment passes, through the same `applyRepresentationTermination` path an
 * immediate termination takes in the API.
 */
describe("reapDueRepresentationTerminations", () => {
  it("terminates a due notice and hands the still-open event back to the performer", async () => {
    const seeded = await seedRepresentedEvent(
      `due-${randomUUID().slice(0, 8)}`,
      daysAgo(1), // the agreed moment has passed
    );

    expect(await reapDueRepresentationTerminations(harness.db, NOW)).toBeGreaterThanOrEqual(1);

    const [representation] = await harness.db
      .select()
      .from(schema.representations)
      .where(eq(schema.representations.id, seeded.representationId));
    expect(representation?.status).toBe("terminated");

    // The agent is soft-removed (never deleted — settled money still resolves)…
    expect((await participantRow(seeded.agentParticipantId))?.status).toBe("removed");
    // …and the performer is un-delegated, keeping their other details.
    const performer = await participantRow(seeded.performerParticipantId);
    const details = (performer?.details as Record<string, unknown> | null) ?? {};
    expect(details).not.toHaveProperty("delegatedToAgentProfileId");
    expect(details.callTime).toBe("18:00");
  });

  it("leaves a notice period that has not expired alone", async () => {
    const seeded = await seedRepresentedEvent(
      `pending-${randomUUID().slice(0, 8)}`,
      new Date(NOW.getTime() + 300 * DAY_MS), // agreed for next year
    );

    await reapDueRepresentationTerminations(harness.db, NOW);

    const [representation] = await harness.db
      .select()
      .from(schema.representations)
      .where(eq(schema.representations.id, seeded.representationId));
    expect(representation?.status).toBe("active");
    expect((await participantRow(seeded.agentParticipantId))?.status).toBe("accepted");
    const performer = await participantRow(seeded.performerParticipantId);
    expect(performer?.details).toHaveProperty("delegatedToAgentProfileId");
  });

  it("is idempotent — a swept representation is not swept again", async () => {
    await seedRepresentedEvent(`twice-${randomUUID().slice(0, 8)}`, daysAgo(2));
    const first = await reapDueRepresentationTerminations(harness.db, NOW);
    const second = await reapDueRepresentationTerminations(harness.db, NOW);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });
});

/**
 * The 90-day erasure of unclaimed stub accounts. The only reaper that DELETES,
 * so these tests are as much about what it REFUSES to touch as about what it
 * removes — and about the one field that must survive it: the name on the bill.
 */
describe("reapUnclaimedStubs", () => {
  /** An unclaimed stub of the shape `createPerformerStub` mints, aged to taste. */
  async function seedStub(
    slug: string,
    createdAt: Date,
    kind: "operator" | "performer" = "performer",
  ): Promise<{ profileId: string; ownerUserId: string }> {
    const ownerUserId = `owner-${randomUUID()}`;
    await harness.db
      .insert(schema.users)
      .values({ id: ownerUserId, email: `${slug}-owner@example.com`, kind: "operator" });
    const [stub] = await harness.db
      .insert(schema.profiles)
      .values({
        kind,
        ownerUserId,
        name: `${slug} the act`,
        slug,
        claimedAt: null,
        createdAt,
        createdBy: ownerUserId,
      })
      .returning({ id: schema.profiles.id });
    if (!stub) throw new Error("failed to seed stub");
    // The membership carrying the EMAIL — the personal data this job exists to remove.
    await harness.db.insert(schema.profileMembers).values({
      profileId: stub.id,
      userId: null,
      email: `${slug}@example.com`,
      displayName: `${slug} the act`,
      role: "owner",
      status: "active",
      addedBy: ownerUserId,
    });
    return { profileId: stub.id, ownerUserId };
  }

  it("erases a 90-day-old stub but keeps its name on the bill", async () => {
    const slug = `stale-${randomUUID().slice(0, 8)}`;
    const host = await seedProfile(`host-${slug}`);
    const stub = await seedStub(slug, daysAgo(120));

    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: `${slug} show`,
        baseCurrency: "SEK",
        status: "concluded",
        createdBy: host.userId,
      })
      .returning({ id: schema.events.id });
    if (!event) throw new Error("failed to seed event");
    const [participant] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: stub.profileId,
        role: "performer",
        status: "confirmed",
      })
      .returning({ id: schema.eventParticipants.id });
    if (!participant) throw new Error("failed to seed participant");

    const result = await reapUnclaimedStubs(harness.db, NOW);
    expect(result.purged).toBeGreaterThanOrEqual(1);

    // The account is gone — profile and, with it, the membership holding the email.
    const profiles = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.profileId));
    expect(profiles).toHaveLength(0);
    const members = await harness.db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, stub.profileId));
    expect(members).toHaveLength(0);

    // The bill still names them. This is the whole point.
    const [row] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(row).toBeDefined();
    expect(row?.profileId).toBeNull();
    expect(row?.displayName).toBe(`${slug} the act`);
  });

  it("leaves a stub that is not yet 90 days old", async () => {
    const slug = `young-${randomUUID().slice(0, 8)}`;
    const stub = await seedStub(slug, daysAgo(45));

    await reapUnclaimedStubs(harness.db, NOW);

    const profiles = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.profileId));
    expect(profiles).toHaveLength(1);
  });

  it("leaves a CLAIMED profile alone however old it is", async () => {
    const slug = `claimed-${randomUUID().slice(0, 8)}`;
    const stub = await seedStub(slug, daysAgo(400));
    await harness.db
      .update(schema.profiles)
      .set({ claimedAt: daysAgo(399) })
      .where(eq(schema.profiles.id, stub.profileId));

    await reapUnclaimedStubs(harness.db, NOW);

    const profiles = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.profileId));
    expect(profiles).toHaveLength(1);
  });

  it("keeps the venue's name on the event when a handoff stub is erased", async () => {
    const slug = `venue-${randomUUID().slice(0, 8)}`;
    const host = await seedProfile(`vhost-${slug}`);
    const stub = await seedStub(slug, daysAgo(120), "operator");

    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        venueProfileId: stub.profileId,
        venueName: null,
        title: `${slug} show`,
        baseCurrency: "SEK",
        status: "concluded",
        createdBy: host.userId,
      })
      .returning({ id: schema.events.id });
    if (!event) throw new Error("failed to seed event");

    await reapUnclaimedStubs(harness.db, NOW);

    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.venueProfileId).toBeNull();
    expect(row?.venueName).toBe(`${slug} the act`);
  });

  it("REFUSES to erase a stub that hosts an event, and says why", async () => {
    const slug = `hosting-${randomUUID().slice(0, 8)}`;
    const stub = await seedStub(slug, daysAgo(120), "operator");
    await harness.db.insert(schema.events).values({
      hostProfileId: stub.profileId,
      title: `${slug} show`,
      baseCurrency: "SEK",
      status: "confirmed",
      createdBy: stub.ownerUserId,
    });

    const result = await reapUnclaimedStubs(harness.db, NOW);

    const skipped = result.skipped.find((entry) => entry.profileId === stub.profileId);
    expect(skipped).toBeDefined();
    expect(skipped?.reason).toBe("hosts an event");
    const profiles = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, stub.profileId));
    expect(profiles).toHaveLength(1);
  });

  it("NEVER erases a real account, even though its claimed_at is null", async () => {
    // THE BUG THIS EXISTS TO STOP, measured against production on 2026-09-01.
    //
    // `POST /profiles` has never written `claimed_at` — it is stamped only by the
    // two CLAIM paths — so every genuine profile carries a null there. All six
    // profiles in production did, including both of Ran's. The first version of
    // this reaper treated `claimed_at IS NULL` as "unclaimed stub" and would have
    // hard-deleted every account on the platform as it turned ninety days old.
    //
    // The unit tests passed the whole time, because they seeded stubs the way the
    // query imagined them. This one seeds the shape production actually has.
    const slug = `real-${randomUUID().slice(0, 8)}`;
    const userId = `user-${randomUUID()}`;
    await harness.db
      .insert(schema.users)
      .values({ id: userId, email: `${slug}@example.com`, kind: "operator" });
    const [profile] = await harness.db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: userId,
        name: `${slug} venue`,
        slug,
        // Exactly as `POST /profiles` leaves it: never written.
        claimedAt: null,
        createdAt: daysAgo(400),
        createdBy: userId,
      })
      .returning({ id: schema.profiles.id });
    if (!profile) throw new Error("failed to seed profile");
    // The one thing that distinguishes it from a stub: a member with a real user.
    await harness.db.insert(schema.profileMembers).values({
      profileId: profile.id,
      userId,
      role: "owner",
      status: "active",
      addedBy: userId,
    });

    const result = await reapUnclaimedStubs(harness.db, NOW);

    expect(result.skipped.find((entry) => entry.profileId === profile.id)).toBeUndefined();
    const survivors = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profile.id));
    expect(survivors).toHaveLength(1);
  });

  it("is idempotent — a second sweep finds nothing left to erase", async () => {
    const slug = `twice-${randomUUID().slice(0, 8)}`;
    await seedStub(slug, daysAgo(200));
    const first = await reapUnclaimedStubs(harness.db, NOW);
    expect(first.purged).toBeGreaterThanOrEqual(1);
    const second = await reapUnclaimedStubs(harness.db, NOW);
    expect(second.purged).toBe(0);
  });
});
