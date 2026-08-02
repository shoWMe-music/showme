import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canUseFeature, creditBalance, getPlanTier } from "./lib/entitlements";

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

let seq = 0;
/** Seed a user + owned profile, return the profile id (and the owner uid). */
async function seedProfile(kind: "operator" | "performer") {
  const { db } = harness;
  const id = `ent-${kind}-${seq++}`;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  return { profileId: profile.id, ownerUserId: id };
}

async function setTier(
  profileId: string,
  tier: "free_operator" | "operator_pro" | "free_artist" | "artist_pro",
) {
  await harness.db.insert(schema.plans).values({ profileId, tier });
}

async function seedEvent(hostProfileId: string, createdBy: string, status: string) {
  await harness.db.insert(schema.events).values({
    hostProfileId,
    title: "Show",
    baseCurrency: "SEK",
    status: status as "confirmed",
    createdBy,
  });
}

describe("getPlanTier", () => {
  it("defaults to free_operator / free_artist by kind when there is no plan row", async () => {
    const operator = await seedProfile("operator");
    const performer = await seedProfile("performer");
    expect(await getPlanTier(harness.db, operator.profileId)).toBe("free_operator");
    expect(await getPlanTier(harness.db, performer.profileId)).toBe("free_artist");
  });

  it("defaults to free_operator for an unknown profile", async () => {
    expect(await getPlanTier(harness.db, "00000000-0000-0000-0000-000000000000")).toBe(
      "free_operator",
    );
  });

  it("reads the stored tier when a plan row exists", async () => {
    const operator = await seedProfile("operator");
    await setTier(operator.profileId, "operator_pro");
    expect(await getPlanTier(harness.db, operator.profileId)).toBe("operator_pro");
  });
});

describe("canUseFeature — create_event", () => {
  it("blocks a free_operator at 3 hosted (confirmed/concluded) events", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");
    // A draft does not count toward the cap.
    await seedEvent(operator.profileId, operator.ownerUserId, "draft");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check).toMatchObject({ allowed: false, used: 3, limit: 3 });
  });

  it("allows a free_operator still under the cap", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check).toMatchObject({ allowed: true, used: 2, limit: 3 });
  });

  it("does not count events older than 365 days", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    // A future 'now' pushes the recent event outside the rolling window.
    const oneYearLater = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const check = await canUseFeature(harness.db, operator.profileId, "create_event", oneYearLater);
    expect(check).toMatchObject({ allowed: true, used: 0, limit: 3 });
  });

  it("gives a paid tier unlimited events", async () => {
    const operator = await seedProfile("operator");
    await setTier(operator.profileId, "operator_pro");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });
});

describe("canUseFeature — send_offer", () => {
  async function seedOffer(senderUserId: string, targetProfileId: string, createdAt?: Date) {
    await harness.db.insert(schema.bookingRequests).values({
      source: "performer_offer",
      senderUserId,
      targetProfileId,
      ...(createdAt ? { createdAt } : {}),
    });
  }

  it("meters a free_artist by offers sent this calendar month", async () => {
    const performer = await seedProfile("performer");
    const target = await seedProfile("operator");
    await seedOffer(performer.ownerUserId, target.profileId);
    await seedOffer(performer.ownerUserId, target.profileId);

    const check = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(check).toMatchObject({ allowed: true, used: 2, limit: 50 });
  });

  it("gives a paid artist unlimited offers", async () => {
    const performer = await seedProfile("performer");
    await setTier(performer.profileId, "artist_pro");
    const check = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });
});

describe("canUseFeature — grant_admin", () => {
  it("is gated by a paid tier", async () => {
    const free = await seedProfile("operator");
    const paid = await seedProfile("operator");
    await setTier(paid.profileId, "operator_pro");

    expect((await canUseFeature(harness.db, free.profileId, "grant_admin")).allowed).toBe(false);
    expect((await canUseFeature(harness.db, paid.profileId, "grant_admin")).allowed).toBe(true);
  });
});

describe("canUseFeature — not_spam_suspended", () => {
  async function flag(targetProfileId: string, reporterProfileId: string) {
    await harness.db.insert(schema.spamFlags).values({
      targetProfileId,
      reporterProfileId,
      kind: "offer",
    });
  }

  it("flips to suspended at 3 distinct reporters", async () => {
    const target = await seedProfile("performer");
    const r1 = await seedProfile("operator");
    const r2 = await seedProfile("operator");
    const r3 = await seedProfile("operator");

    await flag(target.profileId, r1.profileId);
    await flag(target.profileId, r2.profileId);
    // Two flags in the window, allowed.
    expect((await canUseFeature(harness.db, target.profileId, "not_spam_suspended")).allowed).toBe(
      true,
    );

    await flag(target.profileId, r3.profileId);
    // Third distinct reporter suspends.
    const suspended = await canUseFeature(harness.db, target.profileId, "not_spam_suspended");
    expect(suspended).toMatchObject({ allowed: false, used: 3, limit: 3 });
  });
});

describe("creditBalance", () => {
  it("sums the ledger deltas (0 when empty)", async () => {
    const profile = await seedProfile("operator");
    expect(await creditBalance(harness.db, profile.profileId)).toBe(0);

    await harness.db.insert(schema.creditLedger).values([
      { profileId: profile.profileId, delta: 5, reason: "grant" },
      { profileId: profile.profileId, delta: -2, reason: "spend" },
      { profileId: profile.profileId, delta: 3, reason: "grant" },
    ]);
    expect(await creditBalance(harness.db, profile.profileId)).toBe(6);
  });
});
