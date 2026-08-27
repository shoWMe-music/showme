import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { contactRoutes } from "./routes/contacts";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [contactRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + a profile they own, with a member row at `role`. Returns the profile id. */
async function seedProfileMember(
  id: string,
  role: "owner" | "admin" | "editor" | "viewer" | "crew",
  profileId?: string,
) {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  let targetProfileId = profileId;
  if (!targetProfileId) {
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    targetProfileId = profile.id;
  }
  await db
    .insert(schema.profileMembers)
    .values({ profileId: targetProfileId, userId: id, role, status: "active" });
  return targetProfileId;
}

describe("contacts — profile-scoped address book", () => {
  it("lets an owner create a contact with persons and read it back", async () => {
    const profileId = await seedProfileMember("con-owner", "owner");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/contacts`,
      headers: auth("con-owner"),
      payload: {
        name: "Acme Booking",
        type: "agency",
        iban: "SE3550000000054910000003",
        bankName: "SEB",
        vatId: "SE556000000001",
        address: "Stockholm",
        notes: "primary agent",
        persons: [{ name: "Jane Doe", email: "jane@acme.showme.test", phone: "+46700000000" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe("Acme Booking");
    expect(created.json().persons).toEqual([
      { name: "Jane Doe", email: "jane@acme.showme.test", phone: "+46700000000" },
    ]);
    const contactId = created.json().id;

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, contactId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("contact.create");
    expect(audit[0]?.actorUserId).toBe("con-owner");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/contacts`,
      headers: auth("con-owner"),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].id).toBe(contactId);
    expect(list.json()[0].persons[0].name).toBe("Jane Doe");
  });

  it("updates and deletes a contact with audit", async () => {
    const profileId = await seedProfileMember("con-edit", "owner");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/contacts`,
      headers: auth("con-edit"),
      payload: { name: "Before" },
    });
    const contactId = created.json().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}/contacts/${contactId}`,
      headers: auth("con-edit"),
      payload: { name: "After", notes: "changed" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("After");
    expect(updated.json().notes).toBe("changed");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/profiles/${profileId}/contacts/${contactId}`,
      headers: auth("con-edit"),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().deleted).toBe(true);

    const actions = (
      await harness.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, contactId))
    )
      .map((row) => row.action)
      .sort();
    expect(actions).toEqual(["contact.create", "contact.delete", "contact.update"]);
  });

  it("404s a non-member of the profile", async () => {
    const profileId = await seedProfileMember("con-host", "owner");
    await harness.db
      .insert(schema.users)
      .values({ id: "con-stranger", email: "con-stranger@example.showme.test", kind: "operator" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/contacts`,
      headers: auth("con-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("403s a viewer trying to create a contact", async () => {
    const profileId = await seedProfileMember("con-vowner", "owner");
    // A second user joins the same profile as a viewer.
    await seedProfileMember("con-viewer", "viewer", profileId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/contacts`,
      headers: auth("con-viewer"),
      payload: { name: "Nope" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("404s a contact that belongs to another profile (no cross-profile leak)", async () => {
    const profileA = await seedProfileMember("con-leak-a", "owner");
    const profileB = await seedProfileMember("con-leak-b", "owner");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileB}/contacts`,
      headers: auth("con-leak-b"),
      payload: { name: "B's contact" },
    });
    const contactId = created.json().id;

    // A is an owner of their own profile, but the contact is B's → 404.
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileA}/contacts/${contactId}`,
      headers: auth("con-leak-a"),
      payload: { name: "hijack" },
    });
    expect(response.statusCode).toBe(404);
  });
});
