import { randomUUID } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reapExpiredHandoffs, reapExpiredOffers, reapExpiredShares } from "./reapers";

let harness: TestDatabase;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** A minimal owner user + profile to satisfy the FKs the reaped rows hang off. */
async function seedProfile(slug: string): Promise<{ userId: string; profileId: string }> {
  const userId = `user-${randomUUID()}`;
  await harness.db
    .insert(schema.users)
    .values({ id: userId, email: `${slug}@example.com`, kind: "operator" });
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: userId, name: slug, slug })
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

    const [stale] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "pending",
        targetProfileId: profileId,
        createdAt: daysAgo(40),
      })
      .returning({ id: schema.bookingRequests.id });
    const [fresh] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "pending",
        targetProfileId: profileId,
        createdAt: daysAgo(5),
      })
      .returning({ id: schema.bookingRequests.id });
    const [wrongSource] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "public_form",
        status: "pending",
        targetProfileId: profileId,
        createdAt: daysAgo(40),
      })
      .returning({ id: schema.bookingRequests.id });
    const [alreadyAccepted] = await harness.db
      .insert(schema.bookingRequests)
      .values({
        source: "performer_offer",
        status: "accepted",
        targetProfileId: profileId,
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
