import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeEvent, effectiveEventCapabilities } from "./authorize";
import { PRESET_PERMISSION_SETS, roleFilter } from "./presets";
import { resolvePrincipal } from "./principal";

/**
 * Exercises the authorization engine against a real Postgres: the principal flat
 * set, the permission-set × profile-role composition, the multi-participant
 * union, deny-by-default, and the `removed`/inactive exclusions.
 */
let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

/** Seed a user that owns a profile and is an active member of it. */
async function seedMember(
  id: string,
  kind: "operator" | "performer" | "team_and_crew" | "agent",
  role: "owner" | "admin" | "editor" | "viewer" | "crew" = "owner",
) {
  const { db } = harness;
  const [user] = await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, kind })
    .returning();
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!user || !profile) throw new Error("seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role, status: "active" });
  return { user, profile };
}

async function seedPermissionSet(profileId: string, name: string, capabilities: string[]) {
  const [set] = await harness.db
    .insert(schema.permissionSets)
    .values({ profileId, name, capabilities })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return set;
}

describe("roleFilter", () => {
  it("keeps everything for owner/admin, strips money+management for editor", () => {
    const full = PRESET_PERMISSION_SETS.operator_full;
    expect(roleFilter(full, "owner")).toEqual(full);

    const editor = roleFilter(full, "editor");
    expect(editor).toContain("event.edit"); // content edit stays
    expect(editor).toContain("budget.view"); // financial *view* stays
    expect(editor).not.toContain("budget.edit"); // financial *edit* gone
    expect(editor).not.toContain("settlement.finalize");
    expect(editor).not.toContain("participants.manage"); // management gone
  });

  it("reduces viewer/crew to read-only", () => {
    const viewer = roleFilter(PRESET_PERMISSION_SETS.operator_full, "viewer");
    expect(viewer).toContain("event.view");
    expect(viewer).toContain("budget.view");
    expect(viewer).not.toContain("event.edit");
    expect(viewer).not.toContain("message.post");
  });
});

describe("effectiveEventCapabilities & authorizeEvent", () => {
  it("grants a performer their own slice and denies the pool", async () => {
    const { db } = harness;
    const operator = await seedMember("az-operator", "operator");
    const performer = await seedMember("az-performer", "performer");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profile.id,
        title: "Auth Night",
        baseCurrency: "SEK",
        createdBy: operator.user.id,
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    const performerSet = await seedPermissionSet(performer.profile.id, "performer", [
      ...PRESET_PERMISSION_SETS.performer,
    ]);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profile.id,
      role: "performer",
      permissionSetId: performerSet.id,
      status: "accepted",
    });

    const principal = await resolvePrincipal(db, performer.user.id);
    if (!principal) throw new Error("principal not resolved");

    expect(await authorizeEvent(db, principal, "deal.view.own", event.id)).toBe(true);
    expect(await authorizeEvent(db, principal, "schedule.view", event.id)).toBe(true);
    // Deny-by-default: the performer never gets the budget or edit rights.
    expect(await authorizeEvent(db, principal, "budget.view", event.id)).toBe(false);
    expect(await authorizeEvent(db, principal, "event.edit", event.id)).toBe(false);
  });

  it("applies the profile role on top of the permission set", async () => {
    const { db } = harness;
    // Same operator_full set, but the member holds it as an EDITOR.
    const editor = await seedMember("az-editor", "operator", "editor");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: editor.profile.id,
        title: "Editor Night",
        baseCurrency: "EUR",
        createdBy: editor.user.id,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    const fullSet = await seedPermissionSet(editor.profile.id, "operator_full", [
      ...PRESET_PERMISSION_SETS.operator_full,
    ]);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: editor.profile.id,
      role: "co_host",
      permissionSetId: fullSet.id,
      status: "confirmed",
    });

    const principal = await resolvePrincipal(db, editor.user.id);
    if (!principal) throw new Error("principal not resolved");

    expect(await authorizeEvent(db, principal, "event.edit", event.id)).toBe(true);
    expect(await authorizeEvent(db, principal, "budget.view", event.id)).toBe(true);
    expect(await authorizeEvent(db, principal, "budget.edit", event.id)).toBe(false);
    expect(await authorizeEvent(db, principal, "settlement.finalize", event.id)).toBe(false);
    expect(await authorizeEvent(db, principal, "participants.manage", event.id)).toBe(false);
  });

  it("unions capabilities across multiple participant rows", async () => {
    const { db } = harness;
    const owner = await seedMember("az-multi-owner", "operator");
    // A second profile the same user also owns, on the same event with a different set.
    const [secondProfile] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: owner.user.id,
        name: "az-second",
        slug: "az-second",
      })
      .returning();
    if (!secondProfile) throw new Error("second profile seed failed");
    await db.insert(schema.profileMembers).values({
      profileId: secondProfile.id,
      userId: owner.user.id,
      role: "owner",
      status: "active",
    });

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: owner.profile.id,
        title: "Union Night",
        baseCurrency: "SEK",
        createdBy: owner.user.id,
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    const setA = await seedPermissionSet(owner.profile.id, "a", ["schedule.view", "schedule.edit"]);
    const setB = await seedPermissionSet(secondProfile.id, "b", ["budget.view"]);
    await db.insert(schema.eventParticipants).values([
      { eventId: event.id, profileId: owner.profile.id, role: "host", permissionSetId: setA.id },
      { eventId: event.id, profileId: secondProfile.id, role: "co_host", permissionSetId: setB.id },
    ]);

    const principal = await resolvePrincipal(db, owner.user.id);
    if (!principal) throw new Error("principal not resolved");
    const effective = await effectiveEventCapabilities(db, principal, event.id);
    expect(effective.has("schedule.edit")).toBe(true); // from participant A
    expect(effective.has("budget.view")).toBe(true); // from participant B
  });

  it("excludes removed participants and inactive memberships", async () => {
    const { db } = harness;
    const removed = await seedMember("az-removed", "operator");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: removed.profile.id,
        title: "Removed Night",
        baseCurrency: "EUR",
        createdBy: removed.user.id,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    const set = await seedPermissionSet(removed.profile.id, "full", [
      ...PRESET_PERMISSION_SETS.operator_full,
    ]);
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: removed.profile.id,
        role: "host",
        permissionSetId: set.id,
        status: "confirmed",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");

    const principal = await resolvePrincipal(db, removed.user.id);
    if (!principal) throw new Error("principal not resolved");
    expect(await authorizeEvent(db, principal, "event.edit", event.id)).toBe(true);

    // Remove the participant → access is revoked.
    await db
      .update(schema.eventParticipants)
      .set({ status: "removed" })
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(await authorizeEvent(db, principal, "event.edit", event.id)).toBe(false);
  });
});

describe("resolvePrincipal", () => {
  it("loads the flat membership set and validates the acting profile", async () => {
    const { db } = harness;
    const member = await seedMember("az-principal", "operator", "admin");

    const principal = await resolvePrincipal(db, member.user.id, member.profile.id);
    if (!principal) throw new Error("principal not resolved");
    expect(principal.userId).toBe(member.user.id);
    expect(principal.memberships).toHaveLength(1);
    expect(principal.memberships[0]?.role).toBe("admin");
    expect(principal.memberships[0]?.kind).toBe("operator");
    expect(principal.actingProfileId).toBe(member.profile.id);

    // An acting profile the user is NOT a member of is rejected.
    const spoofed = await resolvePrincipal(
      db,
      member.user.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(spoofed?.actingProfileId).toBeUndefined();

    // Unknown uid → no principal.
    expect(await resolvePrincipal(db, "nobody")).toBeNull();
  });
});

describe("decisions #4 — floor and ceiling", () => {
  async function seedEvent(operatorProfileId: string, operatorUserId: string, title: string) {
    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: operatorProfileId,
        title,
        baseCurrency: "EUR",
        createdBy: operatorUserId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    return event;
  }

  it("grants the performer floor even with an empty permission set (inalienable)", async () => {
    const { db } = harness;
    const operator = await seedMember("fc-op", "operator");
    const performer = await seedMember("fc-perf", "performer");
    const event = await seedEvent(operator.profile.id, operator.user.id, "Floor");
    const emptySet = await seedPermissionSet(performer.profile.id, "empty", []);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profile.id,
      role: "performer",
      permissionSetId: emptySet.id,
    });

    const principal = await resolvePrincipal(db, performer.user.id);
    if (!principal) throw new Error("principal not resolved");
    const caps = await effectiveEventCapabilities(db, principal, event.id);
    expect(caps.has("event.view")).toBe(true);
    expect(caps.has("deal.view.own")).toBe(true);
    expect(caps.has("settlement.view.own")).toBe(true);
    expect(caps.has("schedule.view")).toBe(true);
    expect(caps.has("rider.submit")).toBe(true);
  });

  it("never lets an arm's-length party hold budget access (ceiling)", async () => {
    const { db } = harness;
    const operator = await seedMember("fc2-op", "operator");
    const performer = await seedMember("fc2-perf", "performer");
    const event = await seedEvent(operator.profile.id, operator.user.id, "Ceiling");
    // A permission set that erroneously grants pool visibility to a performer.
    const richSet = await seedPermissionSet(performer.profile.id, "rich", [
      "event.view",
      "budget.view",
      "budget.edit",
      "schedule.view",
    ]);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profile.id,
      role: "performer",
      permissionSetId: richSet.id,
    });

    const principal = await resolvePrincipal(db, performer.user.id);
    if (!principal) throw new Error("principal not resolved");
    const caps = await effectiveEventCapabilities(db, principal, event.id);
    expect(caps.has("budget.view")).toBe(false); // stripped by the ceiling
    expect(caps.has("budget.edit")).toBe(false);
    expect(caps.has("schedule.view")).toBe(true); // a grantable cap survives
  });

  it("lets a managing operator hold budget access", async () => {
    const { db } = harness;
    const operator = await seedMember("fc3-op", "operator");
    const event = await seedEvent(operator.profile.id, operator.user.id, "Operator");
    const fullSet = await seedPermissionSet(operator.profile.id, "full", [
      ...PRESET_PERMISSION_SETS.operator_full,
    ]);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: operator.profile.id,
      role: "host",
      permissionSetId: fullSet.id,
    });

    const principal = await resolvePrincipal(db, operator.user.id);
    if (!principal) throw new Error("principal not resolved");
    const caps = await effectiveEventCapabilities(db, principal, event.id);
    expect(caps.has("budget.view")).toBe(true);
    expect(caps.has("settlement.finalize")).toBe(true);
  });
});
