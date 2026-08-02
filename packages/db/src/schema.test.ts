import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./index";
import { type TestDatabase, startTestDatabase } from "./testing";

/**
 * Module round-trip tests against a real Postgres running the generated
 * migrations — the executable spec for the schema. One container is shared
 * across every module's describe block; add a new block per module.
 */
let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

/** Small helpers so each test starts from a known-good spine without repetition. */
async function createUser(id: string, kind: "operator" | "performer" | "professional" | "agent") {
  const [user] = await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, kind })
    .returning();
  if (!user) throw new Error("user insert returned nothing");
  return user;
}

async function createProfile(
  ownerUserId: string,
  kind: "operator" | "performer" | "professional" | "agent",
  slug: string,
) {
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind, ownerUserId, name: slug, slug })
    .returning();
  if (!profile) throw new Error("profile insert returned nothing");
  return profile;
}

describe("Module 1 — identity", () => {
  it("round-trips a user → profile → permission set → member", async () => {
    const { db } = harness;
    const user = await createUser("m1-owner", "operator");
    const profile = await createProfile(user.id, "operator", "the-old-hall");

    const [permissionSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: profile.id,
        name: "Host admin",
        capabilities: ["event.edit", "budget.view"],
      })
      .returning();
    if (!permissionSet) throw new Error("permission set insert returned nothing");

    await db.insert(schema.profileMembers).values({
      profileId: profile.id,
      userId: user.id,
      role: "owner",
      permissionSetId: permissionSet.id,
    });

    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, profile.id));

    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.permissionSetId).toBe(permissionSet.id);
    expect(permissionSet.capabilities).toEqual(["event.edit", "budget.view"]);
  });

  it("rejects an unknown account kind", async () => {
    const { db } = harness;
    await expect(
      db
        .insert(schema.users)
        // biome-ignore lint/suspicious/noExplicitAny: deliberately violating the enum
        .values({ id: "m1-bad-kind", email: "x@example.com", kind: "manager" as any }),
    ).rejects.toThrow();
  });

  it("enforces one membership per (profile, user)", async () => {
    const { db } = harness;
    const user = await createUser("m1-dupe", "performer");
    const profile = await createProfile(user.id, "performer", "dj-dupe");

    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: user.id, role: "owner" });

    await expect(
      db
        .insert(schema.profileMembers)
        .values({ profileId: profile.id, userId: user.id, role: "editor" }),
    ).rejects.toThrow();
  });
});

describe("Module 2 — events", () => {
  it("joins a performer onto an operator's event via event_participants", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m2-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "grand-stage");
    const performerUser = await createUser("m2-performer", "performer");
    const band = await createProfile(performerUser.id, "performer", "the-band");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Saturday Night Live",
        baseCurrency: "SEK",
        eventDate: "2026-09-12",
        doorTime: "19:00:00",
        timezone: "Europe/Stockholm",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    expect(event.status).toBe("draft");
    expect(event.published).toBe(false);

    await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: venue.id, role: "host", status: "confirmed" });
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: band.id,
      role: "performer",
      performerTag: "headliner",
    });

    // The access join that replaces the accessUids fan-out: which events can this
    // performer's user reach?
    const reachable = await db
      .select({ id: schema.events.id, title: schema.events.title })
      .from(schema.events)
      .innerJoin(schema.eventParticipants, eq(schema.eventParticipants.eventId, schema.events.id))
      .innerJoin(
        schema.profileMembers,
        eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
      )
      .where(eq(schema.profileMembers.userId, performerUser.id));

    // Not yet a member of the band profile → no access.
    expect(reachable).toHaveLength(0);

    await db
      .insert(schema.profileMembers)
      .values({ profileId: band.id, userId: performerUser.id, role: "owner" });

    const reachableNow = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .innerJoin(schema.eventParticipants, eq(schema.eventParticipants.eventId, schema.events.id))
      .innerJoin(
        schema.profileMembers,
        eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
      )
      .where(eq(schema.profileMembers.userId, performerUser.id));

    expect(reachableNow).toHaveLength(1);
    expect(reachableNow[0]?.id).toBe(event.id);
  });

  it("enforces one participation per (event, profile)", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m2-dupe-op", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "dupe-venue");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Dupe Fest",
        baseCurrency: "EUR",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");

    await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: venue.id, role: "host" });

    await expect(
      db
        .insert(schema.eventParticipants)
        .values({ eventId: event.id, profileId: venue.id, role: "co_host" }),
    ).rejects.toThrow();
  });

  it("keeps venue-owned stages when an event is deleted, but cascades participants", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m2-cascade", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "cascade-venue");

    // A stage is a permanent attribute of the venue profile, not the event.
    const [stage] = await db
      .insert(schema.stages)
      .values({ venueProfileId: venue.id, name: "Main Stage", capacity: 500 })
      .returning();
    if (!stage) throw new Error("stage insert returned nothing");

    // The event is placed on one of the venue's stages.
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        venueProfileId: venue.id,
        stageId: stage.id,
        title: "Cascade Fest",
        baseCurrency: "EUR",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    expect(event.stageId).toBe(stage.id);

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: venue.id,
      role: "host",
    });

    await db.delete(schema.events).where(eq(schema.events.id, event.id));

    const orphanParticipants = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));
    expect(orphanParticipants).toHaveLength(0);

    // The stage belongs to the venue — it outlives the event.
    const survivingStages = await db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.venueProfileId, venue.id));
    expect(survivingStages).toHaveLength(1);
    expect(survivingStages[0]?.id).toBe(stage.id);

    // Deleting the venue profile does cascade its stages away.
    await db.delete(schema.profiles).where(eq(schema.profiles.id, venue.id));
    const afterVenueDelete = await db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.venueProfileId, venue.id));
    expect(afterVenueDelete).toHaveLength(0);
  });
});

describe("Module 3 — deals", () => {
  it("scopes a split deal to its parties and redacts non-parties", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m3-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m3-venue");
    const bandUserA = await createUser("m3-band-a", "performer");
    const bandA = await createProfile(bandUserA.id, "performer", "m3-band-a");
    const bandUserB = await createUser("m3-band-b", "performer");
    const bandB = await createProfile(bandUserB.id, "performer", "m3-band-b");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Split Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");

    const participants = await db
      .insert(schema.eventParticipants)
      .values([
        { eventId: event.id, profileId: venue.id, role: "host" },
        { eventId: event.id, profileId: bandA.id, role: "performer" },
        { eventId: event.id, profileId: bandB.id, role: "performer" },
      ])
      .returning();
    const hostPart = participants.find((row) => row.profileId === venue.id);
    const partA = participants.find((row) => row.profileId === bandA.id);
    const partB = participants.find((row) => row.profileId === bandB.id);
    if (!hostPart || !partA || !partB) throw new Error("participant insert incomplete");

    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "split",
        structure: "door_split",
        name: "Door split 50/50",
        currency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!deal) throw new Error("deal insert returned nothing");

    await db.insert(schema.dealParties).values([
      {
        dealId: deal.id,
        participantId: partA.id,
        roleInDeal: "split_member",
        share: { percent: 50 },
      },
      {
        dealId: deal.id,
        participantId: partB.id,
        roleInDeal: "split_member",
        share: { percent: 50 },
      },
      // The operator sees the deal via an observer party (read-only, no entitlement).
      { dealId: deal.id, participantId: hostPart.id, roleInDeal: "observer" },
    ]);

    // "Which deals is participant A on?" — the indexed by-party lookup.
    const dealsForA = await db
      .select({ dealId: schema.dealParties.dealId })
      .from(schema.dealParties)
      .where(eq(schema.dealParties.participantId, partA.id));
    expect(dealsForA).toHaveLength(1);

    // Band A never sees Band B's line: filter the deal's parties to A's own.
    const aOwnLines = await db
      .select()
      .from(schema.dealParties)
      .where(
        and(eq(schema.dealParties.dealId, deal.id), eq(schema.dealParties.participantId, partA.id)),
      );
    expect(aOwnLines).toHaveLength(1);
    expect(aOwnLines[0]?.roleInDeal).toBe("split_member");

    const allParties = await db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    expect(allParties).toHaveLength(3);
  });

  it("cascades parties when a deal is deleted", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m3-cascade", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m3-cascade-venue");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Cascade Deal",
        baseCurrency: "EUR",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: venue.id, role: "host" })
      .returning();
    if (!participant) throw new Error("participant insert returned nothing");
    const [deal] = await db
      .insert(schema.deals)
      .values({ eventId: event.id, type: "rental", name: "Rental", createdBy: operatorUser.id })
      .returning();
    if (!deal) throw new Error("deal insert returned nothing");
    await db
      .insert(schema.dealParties)
      .values({ dealId: deal.id, participantId: participant.id, roleInDeal: "payee" });

    await db.delete(schema.deals).where(eq(schema.deals.id, deal.id));

    const orphans = await db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    expect(orphans).toHaveLength(0);
  });
});

describe("Module 4 — budget & settlement", () => {
  it("reconciles a worked example into a paid transfer", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m4-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m4-venue");
    const bandUser = await createUser("m4-band", "performer");
    const band = await createProfile(bandUser.id, "performer", "m4-band");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Reconcile Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");

    const parts = await db
      .insert(schema.eventParticipants)
      .values([
        { eventId: event.id, profileId: venue.id, role: "host" },
        { eventId: event.id, profileId: band.id, role: "performer" },
      ])
      .returning();
    const host = parts.find((row) => row.profileId === venue.id);
    const performer = parts.find((row) => row.profileId === band.id);
    if (!host || !performer) throw new Error("participant insert incomplete");

    const [budget] = await db
      .insert(schema.budgets)
      .values({ eventId: event.id, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget insert returned nothing");

    await db.insert(schema.budgetLines).values([
      {
        budgetId: budget.id,
        kind: "revenue",
        label: "Tickets",
        amount: 1_000_000n, // €10,000 in minor units
        collectedBy: host.id,
      },
      {
        budgetId: budget.id,
        kind: "cost",
        label: "Production",
        amount: 150_000n, // €1,500
        paidBy: host.id,
      },
    ]);

    // Pool = Σ revenue − Σ external cost (minor units).
    const lines = await db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, budget.id));
    const pool = lines.reduce(
      (total, line) => total + (line.kind === "revenue" ? line.amount : -line.amount),
      0n,
    );
    expect(pool).toBe(850_000n);

    const [settlement] = await db
      .insert(schema.settlements)
      .values({ eventId: event.id, participantId: performer.id, status: "open" })
      .returning();
    if (!settlement) throw new Error("settlement insert returned nothing");

    const [transfer] = await db
      .insert(schema.settlementTransfers)
      .values({
        eventId: event.id,
        fromParticipant: host.id,
        toParticipant: performer.id,
        amount: 300_000n, // €3,000
        currency: "SEK",
      })
      .returning();
    if (!transfer) throw new Error("transfer insert returned nothing");
    expect(transfer.state).toBe("owed");

    await db
      .update(schema.settlementTransfers)
      .set({ state: "paid" })
      .where(eq(schema.settlementTransfers.id, transfer.id));
    const [settled] = await db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.id, transfer.id));
    expect(settled?.state).toBe("paid");
  });

  it("requires exactly one settlement subject (participant XOR representation)", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m4-xor-op", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m4-xor-venue");
    const agentUser = await createUser("m4-xor-agent", "agent");
    const agent = await createProfile(agentUser.id, "agent", "m4-xor-agent");
    const bandUser = await createUser("m4-xor-band", "performer");
    const band = await createProfile(bandUser.id, "performer", "m4-xor-band");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "XOR Night",
        baseCurrency: "EUR",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: band.id, role: "performer" })
      .returning();
    if (!participant) throw new Error("participant insert returned nothing");
    const [representation] = await db
      .insert(schema.representations)
      .values({ agentProfileId: agent.id, performerProfileId: band.id, proposedBy: "agent" })
      .returning();
    if (!representation) throw new Error("representation insert returned nothing");

    // Neither subject set → rejected.
    await expect(db.insert(schema.settlements).values({ eventId: event.id })).rejects.toThrow();

    // Both subjects set → rejected.
    await expect(
      db.insert(schema.settlements).values({
        eventId: event.id,
        participantId: participant.id,
        representationId: representation.id,
      }),
    ).rejects.toThrow();

    // Exactly the representation → accepted (the private commission settlement).
    const [commissionSettlement] = await db
      .insert(schema.settlements)
      .values({ eventId: event.id, representationId: representation.id })
      .returning();
    expect(commissionSettlement?.representationId).toBe(representation.id);
    expect(commissionSettlement?.participantId).toBeNull();
  });
});

describe("Module 5 — event content", () => {
  it("copies a library rider into an event instance", async () => {
    const { db } = harness;
    const bandUser = await createUser("m5-band", "performer");
    const band = await createProfile(bandUser.id, "performer", "m5-band");
    const operatorUser = await createUser("m5-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m5-venue");

    // The performer's reusable library rider (no event).
    const [libraryRider] = await db
      .insert(schema.riders)
      .values({
        ownerProfileId: band.id,
        type: "tech",
        name: "Standard tech rider",
        isDefault: true,
        createdBy: bandUser.id,
      })
      .returning();
    if (!libraryRider) throw new Error("library rider insert returned nothing");
    expect(libraryRider.eventId).toBeNull();

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Rider Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: band.id, role: "performer" })
      .returning();
    if (!participant) throw new Error("participant insert returned nothing");

    // Attaching COPIES the library doc, recording its origin.
    const [instanceRider] = await db
      .insert(schema.riders)
      .values({
        ownerProfileId: band.id,
        eventId: event.id,
        ownerParticipantId: participant.id,
        type: "tech",
        name: "Standard tech rider",
        sourceRiderId: libraryRider.id,
        createdBy: bandUser.id,
      })
      .returning();
    if (!instanceRider) throw new Error("instance rider insert returned nothing");
    expect(instanceRider.eventId).toBe(event.id);
    expect(instanceRider.sourceRiderId).toBe(libraryRider.id);
  });

  it("stores message visibility and enforces one setlist per participant", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m5-msg-op", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m5-msg-venue");
    const bandUser = await createUser("m5-msg-band", "performer");
    const band = await createProfile(bandUser.id, "performer", "m5-msg-band");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Message Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, profileId: band.id, role: "performer" })
      .returning();
    if (!participant) throw new Error("participant insert returned nothing");

    const [internalNote] = await db
      .insert(schema.eventMessages)
      .values({
        eventId: event.id,
        senderUserId: operatorUser.id,
        body: "Operators only: settle the rental first.",
        visibility: "operators",
      })
      .returning();
    expect(internalNote?.visibility).toBe("operators");

    await db
      .insert(schema.setlists)
      .values({ eventId: event.id, participantId: participant.id, items: [{ title: "Opener" }] });

    await expect(
      db
        .insert(schema.setlists)
        .values({ eventId: event.id, participantId: participant.id, items: [] }),
    ).rejects.toThrow();
  });
});

describe("Module 6 — monetization", () => {
  it("derives a credit balance from the ledger and pins one plan per profile", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m6-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m6-venue");

    await db.insert(schema.plans).values({ profileId: venue.id, tier: "operator_pro" });
    // Primary key on profile_id → a second plan for the same profile is rejected.
    await expect(
      db.insert(schema.plans).values({ profileId: venue.id, tier: "free_operator" }),
    ).rejects.toThrow();

    await db.insert(schema.creditLedger).values([
      { profileId: venue.id, delta: 5, reason: "signup grant" },
      { profileId: venue.id, delta: -2, reason: "collab invite" },
      { profileId: venue.id, delta: 1, reason: "refund" },
    ]);

    const [balance] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int` })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.profileId, venue.id));
    expect(balance?.total).toBe(4);
  });
});

describe("Module 7 — invitations & contacts", () => {
  it("links a contact to its invitation and enforces unique codes", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m7-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m7-venue");

    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        type: "code",
        code: "SHOW-ABCD-1234",
        source: "collaborator",
        createdByUser: operatorUser.id,
        createdByProfile: venue.id,
        recipientEmail: "promoter@example.com",
      })
      .returning();
    if (!invitation) throw new Error("invitation insert returned nothing");
    expect(invitation.status).toBe("pending");

    // The human code is unique.
    await expect(
      db.insert(schema.invitations).values({
        type: "code",
        code: "SHOW-ABCD-1234",
        source: "collaborator",
        createdByUser: operatorUser.id,
      }),
    ).rejects.toThrow();

    const [contact] = await db
      .insert(schema.contacts)
      .values({
        ownerProfileId: venue.id,
        name: "Acme Promotions",
        iban: "SE0000000000000000000000",
        persons: [{ name: "Jo", email: "jo@acme.example", phone: "+46700000000" }],
        invitationId: invitation.id,
      })
      .returning();
    if (!contact) throw new Error("contact insert returned nothing");
    expect(contact.invitationId).toBe(invitation.id);
    expect((contact.persons as Array<{ email: string }>)[0]?.email).toBe("jo@acme.example");

    // Mark the invite consumed.
    await db
      .update(schema.invitations)
      .set({ status: "used", usedByUser: operatorUser.id })
      .where(eq(schema.invitations.id, invitation.id));
    const [used] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(used?.status).toBe("used");
  });
});

describe("Module 8 — inbound booking requests", () => {
  it("dedups pending requests but allows a re-send after decline", async () => {
    const { db } = harness;
    const venueUser = await createUser("m8-venue-owner", "operator");
    const venue = await createProfile(venueUser.id, "operator", "m8-venue");
    const performerUser = await createUser("m8-performer", "performer");

    const first = {
      source: "performer_offer" as const,
      targetProfileId: venue.id,
      senderUserId: performerUser.id,
      artistName: "The Openers",
      wantedDate: "2026-11-01",
    };
    await db.insert(schema.bookingRequests).values(first);

    // A second pending request for the same (sender, target, date) is blocked.
    await expect(db.insert(schema.bookingRequests).values(first)).rejects.toThrow();

    // Decline the first, then the same offer can be sent again.
    await db
      .update(schema.bookingRequests)
      .set({ status: "declined" })
      .where(
        and(
          eq(schema.bookingRequests.senderUserId, performerUser.id),
          eq(schema.bookingRequests.targetProfileId, venue.id),
        ),
      );

    const [resend] = await db.insert(schema.bookingRequests).values(first).returning();
    expect(resend?.status).toBe("pending");

    // A different wanted_date is always allowed alongside a pending one.
    const [otherDate] = await db
      .insert(schema.bookingRequests)
      .values({ ...first, wantedDate: "2026-12-01" })
      .returning();
    expect(otherDate?.wantedDate).toBe("2026-12-01");
  });
});

describe("Module 9 — settlement sharing", () => {
  it("shares a settlement with a protected recipient and invoices a transfer", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m9-operator", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m9-venue");
    const bandUser = await createUser("m9-band", "performer");
    const band = await createProfile(bandUser.id, "performer", "m9-band");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "Share Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");
    const parts = await db
      .insert(schema.eventParticipants)
      .values([
        { eventId: event.id, profileId: venue.id, role: "host" },
        { eventId: event.id, profileId: band.id, role: "performer" },
      ])
      .returning();
    const host = parts.find((row) => row.profileId === venue.id);
    const performer = parts.find((row) => row.profileId === band.id);
    if (!host || !performer) throw new Error("participant insert incomplete");

    const [share] = await db
      .insert(schema.shares)
      .values({
        token: "share-token-abc",
        eventId: event.id,
        targetKind: "settlement",
        capabilities: ["settlement.view.own"],
        access: "protected",
        ownerUserId: operatorUser.id,
        ownerProfileId: venue.id,
      })
      .returning();
    if (!share) throw new Error("share insert returned nothing");

    await db
      .insert(schema.shareRecipients)
      .values({ shareId: share.id, email: "band@example.com", linkedParticipantId: performer.id });
    // One recipient row per (share, email).
    await expect(
      db.insert(schema.shareRecipients).values({ shareId: share.id, email: "band@example.com" }),
    ).rejects.toThrow();

    await db.insert(schema.shareOtps).values({
      shareId: share.id,
      emailHash: "hash",
      codeHash: "code",
      salt: "salt",
      expiresAt: new Date(Date.now() + 600_000),
    });

    const [transfer] = await db
      .insert(schema.settlementTransfers)
      .values({
        eventId: event.id,
        fromParticipant: host.id,
        toParticipant: performer.id,
        amount: 300_000n, // €3,000
        currency: "SEK",
      })
      .returning();
    if (!transfer) throw new Error("transfer insert returned nothing");

    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        ownerProfileId: venue.id,
        eventId: event.id,
        direction: "issued",
        transferId: transfer.id,
        number: "INV-2026-001",
        currency: "SEK",
        total: 300_000n, // €3,000
      })
      .returning();
    expect(invoice?.transferId).toBe(transfer.id);
    expect(invoice?.state).toBe("draft");
  });
});

describe("Module 10 — comms & misc", () => {
  it("tracks server-side notification read state", async () => {
    const { db } = harness;
    const user = await createUser("m10-user", "operator");
    const [notification] = await db
      .insert(schema.notifications)
      .values({ userId: user.id, type: "settlement_ready", title: "Settle up" })
      .returning();
    if (!notification) throw new Error("notification insert returned nothing");
    expect(notification.readAt).toBeNull();

    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, notification.id));
    const [read] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notification.id));
    expect(read?.readAt).not.toBeNull();
  });

  it("enforces one RSVP per (event, email)", async () => {
    const { db } = harness;
    const operatorUser = await createUser("m10-rsvp-op", "operator");
    const venue = await createProfile(operatorUser.id, "operator", "m10-rsvp-venue");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.id,
        title: "RSVP Night",
        baseCurrency: "SEK",
        createdBy: operatorUser.id,
      })
      .returning();
    if (!event) throw new Error("event insert returned nothing");

    await db.insert(schema.audienceRsvps).values({ eventId: event.id, email: "fan@example.com" });
    await expect(
      db.insert(schema.audienceRsvps).values({ eventId: event.id, email: "fan@example.com" }),
    ).rejects.toThrow();
  });

  it("computes spam suspension from distinct reporters", async () => {
    const { db } = harness;
    const targetUser = await createUser("m10-spam-target", "performer");
    const target = await createProfile(targetUser.id, "performer", "m10-spam-target");

    for (let index = 0; index < 3; index++) {
      const reporterUser = await createUser(`m10-reporter-${index}`, "operator");
      const reporter = await createProfile(reporterUser.id, "operator", `m10-reporter-${index}`);
      await db.insert(schema.spamFlags).values({
        targetProfileId: target.id,
        reporterProfileId: reporter.id,
        reporterUserId: reporterUser.id,
        kind: "impersonation",
      });
      // Same reporter + kind again is rejected — no double-counting.
      await expect(
        db.insert(schema.spamFlags).values({
          targetProfileId: target.id,
          reporterProfileId: reporter.id,
          kind: "impersonation",
        }),
      ).rejects.toThrow();
    }

    const [suspension] = await db
      .select({
        distinctReporters: sql<number>`count(distinct ${schema.spamFlags.reporterProfileId})::int`,
      })
      .from(schema.spamFlags)
      .where(eq(schema.spamFlags.targetProfileId, target.id));
    expect(suspension?.distinctReporters).toBe(3); // → suspended (threshold is 3)
  });
});
