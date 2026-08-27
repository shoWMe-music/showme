import { randomUUID } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymizeUser, exportUserData } from "./gdpr";

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

describe("anonymizeUser", () => {
  it("tombstones the identity, deletes personal content, keeps financial + audit records", async () => {
    const userId = `user-${randomUUID()}`;
    const slug = `band-${randomUUID()}`;

    await harness.db.insert(schema.users).values({
      id: userId,
      email: "jane@example.showme.test",
      name: "Jane Doe",
      initials: "JD",
      avatarUrl: "https://cdn/jane.png",
      kind: "performer",
    });

    const [profile] = await harness.db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: userId,
        name: "Jane's Band",
        slug,
        bio: "We play loud.",
      })
      .returning({ id: schema.profiles.id });
    if (!profile) throw new Error("seed failed");

    const [media] = await harness.db
      .insert(schema.profileMedia)
      .values({ profileId: profile.id, kind: "photo", url: "https://cdn/photo.jpg" })
      .returning({ id: schema.profileMedia.id });
    const [socialLink] = await harness.db
      .insert(schema.profileSocialLinks)
      .values({ profileId: profile.id, platform: "instagram", url: "https://insta/jane" })
      .returning({ id: schema.profileSocialLinks.id });
    const [notification] = await harness.db
      .insert(schema.notifications)
      .values({ userId, type: "booking.received", title: "New booking" })
      .returning({ id: schema.notifications.id });
    if (!media || !socialLink || !notification) throw new Error("seed failed");

    // A finalized-ish settlement that must survive erasure (Σ net = 0 record).
    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: profile.id,
        title: "The Show",
        baseCurrency: "EUR",
        createdBy: userId,
      })
      .returning({ id: schema.events.id });
    if (!event) throw new Error("seed failed");
    const [participant] = await harness.db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: profile.id, role: "performer" })
      .returning({ id: schema.eventParticipants.id });
    if (!participant) throw new Error("seed failed");
    const [settlement] = await harness.db
      .insert(schema.settlements)
      .values({ eventId: event.id, participantId: participant.id, status: "finalized" })
      .returning({ id: schema.settlements.id });
    if (!settlement) throw new Error("seed failed");

    // Forensic audit row (append-only, must survive; carries only the pseudonymous actor id).
    const [audit] = await harness.db
      .insert(schema.auditLog)
      .values({ actorUserId: userId, action: "settlement.finalize", targetKind: "settlement" })
      .returning({ id: schema.auditLog.id });
    if (!audit) throw new Error("seed failed");
    // User-facing activity row (carries the actor's display NAME to be scrubbed).
    const [activity] = await harness.db
      .insert(schema.activityLog)
      .values({ actorUserId: userId, actorDisplay: "Jane Doe", type: "settlement.finalized" })
      .returning({ id: schema.activityLog.id });
    if (!activity) throw new Error("seed failed");

    await anonymizeUser(harness.db, userId);

    // Identity tombstoned: PII overwritten, anonymized_at set, id preserved.
    const [user] = await harness.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.id).toBe(userId);
    expect(user?.email).toBe(`anonymized+${userId}@deleted.invalid`);
    expect(user?.name).toBeNull();
    expect(user?.initials).toBeNull();
    expect(user?.avatarUrl).toBeNull();
    expect(user?.anonymizedAt).toBeInstanceOf(Date);

    // Deletable bucket gone.
    const remainingMedia = await harness.db
      .select({ id: schema.profileMedia.id })
      .from(schema.profileMedia)
      .where(eq(schema.profileMedia.id, media.id));
    expect(remainingMedia).toHaveLength(0);
    const remainingLinks = await harness.db
      .select({ id: schema.profileSocialLinks.id })
      .from(schema.profileSocialLinks)
      .where(eq(schema.profileSocialLinks.id, socialLink.id));
    expect(remainingLinks).toHaveLength(0);
    const remainingNotifications = await harness.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notification.id));
    expect(remainingNotifications).toHaveLength(0);

    // Financial record retained.
    const survivingSettlement = await harness.db
      .select({ id: schema.settlements.id })
      .from(schema.settlements)
      .where(eq(schema.settlements.id, settlement.id));
    expect(survivingSettlement).toHaveLength(1);

    // Forensic audit row retained with its pseudonymous actor id intact.
    const [auditRow] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.id, audit.id));
    expect(auditRow?.id).toBe(audit.id);
    expect(auditRow?.actorUserId).toBe(userId);

    // Activity row retained; actor_display scrubbed but actor_user_id intact.
    const [activityRow] = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.id, activity.id));
    expect(activityRow?.actorUserId).toBe(userId);
    expect(activityRow?.actorDisplay).toBeNull();
  });

  it("throws when the user does not exist", async () => {
    await expect(anonymizeUser(harness.db, `missing-${randomUUID()}`)).rejects.toThrow();
  });
});

describe("exportUserData", () => {
  it("gathers the user's PII across the inventory", async () => {
    const userId = `user-${randomUUID()}`;
    const slug = `export-${randomUUID()}`;
    const email = `export-${randomUUID()}@example.showme.test`;

    await harness.db
      .insert(schema.users)
      .values({ id: userId, email, name: "Export Me", kind: "performer" });
    const [profile] = await harness.db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: userId,
        name: "Export Band",
        slug,
        bio: "Bio here.",
      })
      .returning({ id: schema.profiles.id });
    if (!profile) throw new Error("seed failed");

    await harness.db.insert(schema.bookingRequests).values({
      source: "performer_offer",
      status: "pending",
      targetProfileId: profile.id,
      senderUserId: userId,
      email,
      contactName: "Export Me",
    });
    await harness.db.insert(schema.payoutAccounts).values({
      profileId: profile.id,
      type: "iban",
      identifier: "SE0000000000000000000000",
      holderName: "Export Me",
      bankName: "Bank of Test",
    });

    const result = await exportUserData(harness.db, userId);

    expect(result.userId).toBe(userId);
    expect(typeof result.exportedAt).toBe("string");

    // users PII (matched by user FK).
    expect(result.data.users).toHaveLength(1);
    expect(result.data.users?.[0]).toMatchObject({ email, name: "Export Me" });

    // profiles PII (matched by owner FK).
    expect(result.data.profiles?.[0]).toMatchObject({ name: "Export Band", bio: "Bio here." });

    // booking_requests PII (matched by user FK / email).
    expect(result.data.booking_requests?.[0]).toMatchObject({ email, contactName: "Export Me" });

    // payout_accounts PII (matched via the user's owned profile).
    expect(result.data.payout_accounts?.[0]).toMatchObject({
      identifier: "SE0000000000000000000000",
      holderName: "Export Me",
    });

    // The projection is limited to declared PII columns (no bank internals leak beyond the inventory).
    expect(Object.keys(result.data.users?.[0] ?? {})).toEqual([
      "email",
      "name",
      "initials",
      "avatarUrl",
    ]);
  });

  it("throws when the user does not exist", async () => {
    await expect(exportUserData(harness.db, `missing-${randomUUID()}`)).rejects.toThrow();
  });
});
